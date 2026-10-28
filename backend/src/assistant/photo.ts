import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";
import { AppError } from "../utils/errors.js";
import { LIMITS, type SearchInput, type Observation } from "./schemas.js";

export async function normalizeImage(
  base64: string,
  signal: AbortSignal,
): Promise<Buffer> {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 !== 0)
    throw new AppError(
      400,
      "IMAGE_INVALID",
      "Upload a valid JPEG, PNG or WebP image.",
    );
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length > LIMITS.imageBytes) {
    bytes.fill(0);
    throw new AppError(
      413,
      "IMAGE_TOO_LARGE",
      "Choose one image no larger than 2 MiB.",
    );
  }
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const png = bytes
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp =
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP";
  if (!jpeg && !png && !webp) {
    bytes.fill(0);
    throw new AppError(
      415,
      "IMAGE_UNSUPPORTED",
      "Only JPEG, PNG and WebP images are supported; SVG and remote URLs are not accepted.",
    );
  }
  const { default: sharp } = await import("sharp");
  const pipeline = sharp(bytes, {
    limitInputPixels: LIMITS.pixels,
    animated: false,
    failOn: "warning",
  }).timeout({ seconds: 3 });
  const cancel = () => pipeline.destroy(new Error("cancelled"));
  signal.addEventListener("abort", cancel, { once: true });
  try {
    signal.throwIfAborted();
    const metadata = await pipeline.metadata();
    if (
      !metadata.format ||
      !["jpeg", "png", "webp"].includes(metadata.format) ||
      (metadata.pages ?? 1) !== 1
    )
      throw new AppError(
        415,
        "IMAGE_UNSUPPORTED",
        "Only still JPEG, PNG and WebP images are supported.",
      );
    const { width = 0, height = 0 } = metadata;
    if (
      width < 16 ||
      height < 16 ||
      width > LIMITS.dimension ||
      height > LIMITS.dimension ||
      width * height > LIMITS.pixels
    )
      throw new AppError(
        413,
        "IMAGE_DIMENSIONS",
        "Choose an image between 16 pixels and 8192 pixels per side, with at most 8 megapixels.",
      );
    // Sharp omits EXIF/XMP/ICC metadata by default. A bounded white canvas also
    // avoids passing oversized panoramas or alpha channels to the model.
    return await pipeline
      .rotate()
      .flatten({ background: "#ffffff" })
      .resize(768, 768, { fit: "contain", background: "#ffffff" })
      .jpeg({ quality: 80 })
      .toBuffer();
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (signal.aborted)
      throw new AppError(
        504,
        "AI_TIMEOUT",
        "Image processing was interrupted.",
      );
    if (error instanceof Error && error.message.includes("pixel limit"))
      throw new AppError(
        413,
        "IMAGE_DIMENSIONS",
        "Choose an image with at most 8 megapixels.",
      );
    throw new AppError(
      400,
      "IMAGE_INVALID",
      "This image could not be decoded safely. Try another JPEG, PNG or WebP.",
    );
  } finally {
    signal.removeEventListener("abort", cancel);
    pipeline.destroy();
    bytes.fill(0);
  }
}
const sign = (payload: string) =>
  createHmac("sha256", env.OTP_HASH_SECRET)
    .update("loop-photo-confirmation:" + payload)
    .digest();
export function photoToken(userId: string, observation: Observation) {
  const payload = Buffer.from(
    JSON.stringify({
      userId,
      expires: Date.now() + 600000,
      unresolved:
        observation.unresolvedItems.length > 0 ||
        observation.items.some(
          (item) => item.category === null || item.certainty === "uncertain",
        ),
    }),
  ).toString("base64url");
  return payload + "." + sign(payload).toString("base64url");
}
export function verifyPhotoConfirmation(userId: string, input: SearchInput) {
  const confirmation = input.photoConfirmation;
  if (!confirmation) return;
  try {
    const [payload, signature, extra] = confirmation.token.split(".");
    const bytes = Buffer.from(signature ?? "", "base64url");
    const expected = sign(payload ?? "");
    if (
      extra ||
      bytes.length !== expected.length ||
      !timingSafeEqual(bytes, expected)
    )
      throw new Error();
    const value = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    if (
      value.userId !== userId ||
      value.expires <= Date.now() ||
      !confirmation.confirmed ||
      !input.materials.length ||
      (value.unresolved && !confirmation.acknowledgeUnresolved)
    )
      throw new Error();
  } catch {
    throw new AppError(
      400,
      "PHOTO_CONFIRMATION_REQUIRED",
      "Review and confirm your materials, including any unresolved items, before searching. An expired photo must be analyzed again.",
    );
  }
}
