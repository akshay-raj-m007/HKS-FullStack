import sharp from "sharp";
import { env } from "../src/config/env.js";
import { NvidiaModel } from "../src/assistant/model.js";
import { decisionSchema, observationSchema } from "../src/assistant/schemas.js";
import { indianDay } from "../src/assistant/time.js";

if (
  !process.argv.includes("--live") ||
  !env.NVIDIA_API_KEY ||
  !env.NVIDIA_CHAT_MODEL ||
  !env.NVIDIA_VISION_MODEL
) {
  console.error(
    "BLOCKED: live NVIDIA checks require --live and backend NVIDIA_API_KEY, NVIDIA_CHAT_MODEL and NVIDIA_VISION_MODEL. No model request was sent.",
  );
  process.exitCode = 2;
} else {
  const model = new NvidiaModel();
  try {
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
      "PASS: chat endpoint accepts the configured model and strict structured-output request.",
    );
    const jpeg = await sharp({
      create: { width: 64, height: 64, channels: 3, background: "#888888" },
    })
      .jpeg()
      .toBuffer();
    try {
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
    const response = await fetch(
      "https://integrate.api.nvidia.com/v1/chat/completions",
      {
        method: "POST",
        signal: AbortSignal.timeout(8500),
        headers: {
          Authorization: "Bearer " + env.NVIDIA_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: env.NVIDIA_CHAT_MODEL,
          stream: false,
          max_tokens: 150,
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
    const text = await response.text();
    if (response.ok && text.length <= 16000) {
      const call = JSON.parse(text).choices?.[0]?.message?.tool_calls?.[0];
      console.log(
        call?.function?.name === "get_waste_categories" &&
          call.function.arguments === "{}"
          ? "PASS: optional native function-calling probe returned the allowed function."
          : "UNVERIFIED: optional native tool call was not returned; not required by the deterministic MCP orchestrator.",
      );
    } else
      console.log(
        "UNVERIFIED: optional native function-calling probe unsupported/unavailable; not required at runtime.",
      );
    console.log(
      "Run the human evaluation and authenticated staging API/UI checks in ASK_LOOP.md before enabling production.",
    );
  } catch (error) {
    console.error(
      "FAIL: live model smoke did not pass (" +
        (error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "invalid_or_unavailable") +
        "). No upstream content or credentials are logged. Keep AI_ASSISTANT_ENABLED=false.",
    );
    process.exitCode = 1;
  }
}
