import { createHash, createHmac, timingSafeEqual } from "node:crypto";
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const hmac = (value: string, secret: string) =>
  createHmac("sha256", secret).update(value).digest("hex");
export function safeEqual(a: string, b: string) {
  if (!/^[a-f0-9]{64}$/i.test(a) || !/^[a-f0-9]{64}$/i.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}
