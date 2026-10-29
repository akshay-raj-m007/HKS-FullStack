import sharp from "sharp";
import { z } from "zod";
import { readNvidiaJson } from "../src/assistant/model.js";
import { AppError } from "../src/utils/errors.js";
import {
  nvidiaModelOptions,
  nvidiaFinalContent,
} from "../src/assistant/model-options.js";

// A diagnostic only: no system prompt, tools or response_format, matching the
// basic NVIDIA vision example. Never treat success as an assistant release gate.
export async function basicVisionProbe(
  key: string,
  model: string,
  transport: typeof fetch = fetch,
) {
  const jpeg = await sharp({
    create: { width: 32, height: 32, channels: 3, background: "#888888" },
  })
    .jpeg()
    .toBuffer();
  const signal = AbortSignal.timeout(60000);
  try {
    const response = await transport(
      "https://integrate.api.nvidia.com/v1/chat/completions",
      {
        method: "POST",
        signal,
        headers: {
          Authorization: "Bearer " + key,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: {
                    url: "data:image/jpeg;base64," + jpeg.toString("base64"),
                  },
                },
                { type: "text", text: "Describe this image briefly." },
              ],
            },
          ],
          frequency_penalty: 0,
          presence_penalty: 0,
          stream: false,
          max_tokens: 64,
          temperature: 1,
          top_p: 1,
          ...nvidiaModelOptions(model),
        }),
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new AppError(
        503,
        response.status === 401 || response.status === 403
          ? "AI_AUTH_FAILED"
          : response.status === 429
            ? "AI_UPSTREAM_THROTTLED"
            : "AI_UPSTREAM_UNAVAILABLE",
        "Basic NVIDIA request failed.",
      );
    }
    const parsed = z
      .object({
        choices: z
          .array(
            z.object({
              finish_reason: z.enum(["stop", "length"]),
              message: z.object({
                content: z.string().trim().min(1).max(16000),
              }),
            }),
          )
          .min(1),
      })
      .safeParse(await readNvidiaJson(response));
    if (
      !parsed.success ||
      !nvidiaFinalContent(model, parsed.data.choices[0].message.content).trim()
    )
      throw new AppError(
        502,
        "AI_INVALID_OUTPUT",
        "NVIDIA returned no complete text result.",
      );
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (
      signal.aborted ||
      (error instanceof DOMException &&
        ["TimeoutError", "AbortError"].includes(error.name))
    )
      throw new AppError(
        504,
        "AI_TIMEOUT",
        "Basic vision did not complete within 60 seconds.",
      );
    if (
      error instanceof SyntaxError ||
      (error instanceof Error && ["empty", "oversize"].includes(error.message))
    )
      throw new AppError(
        502,
        "AI_INVALID_OUTPUT",
        "NVIDIA returned an invalid response.",
      );
    throw new AppError(
      503,
      "AI_UPSTREAM_UNAVAILABLE",
      "NVIDIA could not be reached.",
    );
  } finally {
    jpeg.fill(0);
  }
}
