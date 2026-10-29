import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { basicVisionProbe } from "../scripts/assistant-probe.js";
import {
  NEMOTRON_OMNI,
  nvidiaModelOptions,
} from "../src/assistant/model-options.js";

describe("opt-in basic NVIDIA vision diagnostic", () => {
  const model = "meta/llama-3.2-11b-vision-instruct";
  const key = "mock-probe-credential";
  it("matches the documented basic format without weakening runtime JSON validation", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            { message: { content: "A gray image." }, finish_reason: "stop" },
          ],
        }),
      ),
    );
    await basicVisionProbe(key, model, transport);
    const [url, options] = transport.mock.calls[0];
    expect(url).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    expect(options!.headers).toMatchObject({
      Authorization: "Bearer " + key,
      Accept: "application/json",
      "Content-Type": "application/json",
    });
    const payload = JSON.parse(options!.body as string);
    expect(payload).toMatchObject({
      model,
      stream: false,
      max_tokens: 64,
      frequency_penalty: 0,
      presence_penalty: 0,
      temperature: 1,
      top_p: 1,
      messages: [{ role: "user" }],
    });
    expect(payload.response_format).toBeUndefined();
    expect(payload.tools).toBeUndefined();
    expect(payload.messages).toHaveLength(1);
    const image = payload.messages[0].content[0].image_url.url as string;
    expect(image).toMatch(/^data:image\/jpeg;base64,/);
    expect(
      await sharp(Buffer.from(image.split(",")[1], "base64")).metadata(),
    ).toMatchObject({ format: "jpeg", width: 32, height: 32 });
    expect(options!.body).not.toContain(key);
  });
  it("applies the same no-thinking Nemotron settings to basic vision", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              { message: { content: "Gray image" }, finish_reason: "stop" },
            ],
          }),
        ),
      );
    await basicVisionProbe(key, NEMOTRON_OMNI, transport);
    expect(
      JSON.parse(transport.mock.calls[0][1]!.body as string),
    ).toMatchObject({
      reasoning_budget: 0,
      chat_template_kwargs: { enable_thinking: false },
      temperature: 0.2,
    });
    expect(nvidiaModelOptions(model)).not.toHaveProperty("reasoning_budget");
    expect(nvidiaModelOptions(NEMOTRON_OMNI + "-unknown")).toEqual({});
  });
  it.each([401, 403, 429, 422])(
    "reports HTTP %s without retrying or exposing upstream prose",
    async (status) => {
      const transport = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("private upstream detail", { status }));
      await expect(
        basicVisionProbe(key, model, transport),
      ).rejects.toMatchObject({
        code: [401, 403].includes(status)
          ? "AI_AUTH_FAILED"
          : status === 429
            ? "AI_UPSTREAM_THROTTLED"
            : "AI_UPSTREAM_UNAVAILABLE",
        message: "Basic NVIDIA request failed.",
      });
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["not JSON", JSON.stringify({ choices: [] }), "x".repeat(65537)])(
    "rejects malformed, missing or excessive results",
    async (body) => {
      const transport = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(body));
      await expect(
        basicVisionProbe(key, model, transport),
      ).rejects.toMatchObject({ code: "AI_INVALID_OUTPUT" });
    },
  );
  it("distinguishes a transport timeout from an auth/schema error", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockRejectedValue(
        new DOMException("private upstream detail", "TimeoutError"),
      );
    await expect(basicVisionProbe(key, model, transport)).rejects.toMatchObject(
      {
        code: "AI_TIMEOUT",
        message: "Basic vision did not complete within 60 seconds.",
      },
    );
  });
  it("sanitizes network failures", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("private upstream detail"));
    await expect(basicVisionProbe(key, model, transport)).rejects.toMatchObject(
      {
        code: "AI_UPSTREAM_UNAVAILABLE",
        message: "NVIDIA could not be reached.",
      },
    );
  });
});
