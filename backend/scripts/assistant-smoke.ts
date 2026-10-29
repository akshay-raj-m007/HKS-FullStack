import sharp from "sharp";
import { env } from "../src/config/env.js";
import { NvidiaModel, readNvidiaJson } from "../src/assistant/model.js";
import { decisionSchema, observationSchema } from "../src/assistant/schemas.js";
import { indianDay } from "../src/assistant/time.js";
import { basicVisionProbe } from "./assistant-probe.js";
import {
  nvidiaModelOptions,
  NEMOTRON_OMNI,
} from "../src/assistant/model-options.js";

const basic = process.argv.includes("--basic");
let stage = basic ? "basic-vision" : "chat-schema";
const started = Date.now();
const diagnosticFetch: typeof fetch = async (input, options) => {
  const requestStarted = Date.now();
  const response = await fetch(input, options);
  console.log(
    `${stage}: NVIDIA HTTP ${response.status} (${Date.now() - requestStarted} ms to headers).`,
  );
  return response;
};
const hints: Record<string, string> = {
  AI_AUTH_FAILED:
    "NVIDIA rejected authentication/model access (HTTP 401/403). Check the API Catalog key and account/model permissions.",
  AI_TIMEOUT: `No complete inference result arrived within the deadline. Configured attempt limit: ${env.NVIDIA_MODEL_TIMEOUT_MS} ms; overall request limit: 22000 ms. NVIDIA_MODEL_TIMEOUT_MS may be set between 1000 and 18000 in backend/.env. Try --basic to diagnose vision separately with a 60-second limit; it does not enable AI.`,
  AI_INVALID_OUTPUT:
    "The response was incomplete, invalid JSON, or incompatible with the required schema. A successful basic example does not prove assistant structured-output support.",
  AI_UPSTREAM_UNAVAILABLE:
    "Check the HTTP status above and the configured model/request compatibility. Missing status means no response headers arrived.",
  AI_UPSTREAM_THROTTLED:
    "NVIDIA is throttling this account. Wait and retry; do not repeatedly send probes.",
};

if (
  !process.argv.includes("--live") ||
  !env.NVIDIA_API_KEY ||
  (!basic && !env.NVIDIA_CHAT_MODEL) ||
  !env.NVIDIA_VISION_MODEL
) {
  console.error(
    "BLOCKED: put NVIDIA_API_KEY and model settings in backend/.env (not .env.example), and pass --live. Full smoke requires chat + vision; --basic needs vision only. No model request was sent.",
  );
  process.exitCode = 2;
} else {
  const model = new NvidiaModel(diagnosticFetch);
  if (
    env.NVIDIA_CHAT_MODEL === NEMOTRON_OMNI ||
    env.NVIDIA_VISION_MODEL === NEMOTRON_OMNI
  )
    console.log(
      "Nemotron Omni: thinking budget 0; schema in prompt + mandatory server validation; native response_format omitted for this endpoint.",
    );
  try {
    if (basic) {
      console.log(
        "BASIC DIAGNOSTIC ONLY: synthetic inline JPEG; no system prompt, tools or response_format; 60-second timeout.",
      );
      await basicVisionProbe(
        env.NVIDIA_API_KEY,
        env.NVIDIA_VISION_MODEL,
        diagnosticFetch,
      );
      console.log(
        "PASS: basic vision returned text. This does NOT validate assistant JSON schemas, accuracy or production readiness. Run the full smoke without --basic next.",
      );
    } else {
      console.log(
        `Checking chat intent JSON schema (${env.NVIDIA_MODEL_TIMEOUT_MS / 1000} seconds per attempt; 22-second overall stage deadline)...`,
      );
      decisionSchema.parse(
        await model.plan(
          {
            message:
              "Find paper and plastic collection in Bengaluru tomorrow after 4 PM, cheapest first.",
            todayInIndia: indianDay(),
            categories: ["PAPER", "PLASTIC"],
            addressLabels: [],
          },
          AbortSignal.timeout(22000),
        ),
      );
      console.log(
        "PASS: chat returned JSON matching the strict Loop intent schema.",
      );
      const jpeg = await sharp({
        create: { width: 64, height: 64, channels: 3, background: "#888888" },
      })
        .jpeg()
        .toBuffer();
      try {
        stage = "vision-schema";
        console.log("Checking vision observation JSON schema...");
        observationSchema.parse(
          await model.observe(jpeg, AbortSignal.timeout(22000)),
        );
      } finally {
        jpeg.fill(0);
      }
      console.log(
        "PASS: vision endpoint accepts inline JPEG and returns the observation schema. Synthetic gray image only; real-material accuracy is NOT evaluated.",
      );
      // Diagnostic only. Runtime chooses its four MCP tools deterministically from
      // the validated intent; it never depends on native model function calling.
      stage = "optional-native-tools";
      try {
        const response = await diagnosticFetch(
          "https://integrate.api.nvidia.com/v1/chat/completions",
          {
            method: "POST",
            signal: AbortSignal.timeout(8500),
            headers: {
              Authorization: "Bearer " + env.NVIDIA_API_KEY,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              model: env.NVIDIA_CHAT_MODEL,
              stream: false,
              max_tokens: 150,
              ...nvidiaModelOptions(env.NVIDIA_CHAT_MODEL),
              messages: [
                {
                  role: "user",
                  content: "Use get_waste_categories to list Loop materials.",
                },
              ],
              tools: [
                {
                  type: "function",
                  function: {
                    name: "get_waste_categories",
                    description: "Read supported Loop waste categories",
                    parameters: {
                      type: "object",
                      properties: {},
                      additionalProperties: false,
                    },
                  },
                },
              ],
              tool_choice: "auto",
            }),
          },
        );
        if (response.ok) {
          const call = (await readNvidiaJson(response)).choices?.[0]?.message
            ?.tool_calls?.[0];
          console.log(
            call?.function?.name === "get_waste_categories" &&
              call.function.arguments === "{}"
              ? "PASS: optional native function-calling probe returned the allowed function."
              : "UNVERIFIED: optional native tool call was not returned; not required by the deterministic MCP orchestrator.",
          );
        } else {
          await response.body?.cancel();
          console.log(
            "UNVERIFIED: optional native function-calling probe unsupported/unavailable; not required at runtime.",
          );
        }
      } catch {
        console.log(
          "UNVERIFIED: optional native function-calling probe did not complete. Required chat/vision schema checks passed; native tool calling is not used at runtime.",
        );
      }
      console.log(
        "Run the human evaluation and authenticated staging API/UI checks in ASK_LOOP.md before enabling production.",
      );
    }
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "invalid_or_unavailable";
    console.error(
      `FAIL: ${stage} (${code}) after ${Date.now() - started} ms. No upstream content or credentials are logged. Keep AI_ASSISTANT_ENABLED=false.`,
    );
    if (basic && code === "AI_TIMEOUT")
      console.error(
        "The basic vision format did not complete even within 60 seconds. Check the same model in NVIDIA's playground and retry when inference is responsive. The app's deadline has not been increased.",
      );
    else if (hints[code]) console.error(hints[code]);
    process.exitCode = 1;
  }
}
