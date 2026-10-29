import { env } from "../config/env.js";
import { hmac, safeEqual } from "../utils/crypto.js";
import { AppError } from "../utils/errors.js";
import { z } from "zod";
import type { PaymentProvider } from "./provider.js";
const invalidResponse = () =>
  new AppError(
    502,
    "PAYMENT_GATEWAY_INVALID_RESPONSE",
    "Payment gateway returned an unexpected response. Check your order before trying again.",
  );
function decode<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw invalidResponse();
  return parsed.data;
}
const orderSchema = z.object({
  id: z.string(),
  amount: z.number().int(),
  currency: z.string(),
});
const paymentSchema = z.object({
  id: z.string(),
  order_id: z.string(),
  amount: z.number().int(),
  currency: z.string(),
  status: z.string(),
  captured: z.boolean(),
});
export class RazorpayPaymentProvider implements PaymentProvider {
  readonly name = "razorpay" as const;
  readonly publicKey = env.RAZORPAY_KEY_ID;
  private async request(path: string, body?: unknown) {
    let response: Response;
    try {
      response = await fetch("https://api.razorpay.com/v1/" + path, {
        method: body ? "POST" : "GET",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(
              env.RAZORPAY_KEY_ID + ":" + env.RAZORPAY_KEY_SECRET,
            ).toString("base64"),
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new AppError(
        502,
        "PAYMENT_GATEWAY_UNAVAILABLE",
        "Payment gateway did not respond. Check your order before trying again.",
      );
    }
    if (!response.ok)
      throw new AppError(
        502,
        "PAYMENT_GATEWAY_ERROR",
        "Payment gateway could not complete this request.",
      );
    try {
      return (await response.json()) as unknown;
    } catch {
      throw invalidResponse();
    }
  }
  async createOrder(input: {
    amount: number;
    currency: string;
    receipt: string;
  }) {
    return decode(orderSchema, await this.request("orders", input));
  }
  verifySignature(orderId: string, paymentId: string, signature: string) {
    return safeEqual(
      hmac(orderId + "|" + paymentId, env.RAZORPAY_KEY_SECRET),
      signature,
    );
  }
  async fetchPayment(id: string) {
    const p = decode(
      paymentSchema,
      await this.request("payments/" + encodeURIComponent(id)),
    );
    return {
      id: p.id,
      orderId: p.order_id,
      amount: p.amount,
      currency: p.currency,
      captured: p.status === "captured" && p.captured,
    };
  }
  verifyWebhook(raw: Buffer, signature: string) {
    return safeEqual(
      hmac(raw.toString("utf8"), env.RAZORPAY_WEBHOOK_SECRET),
      signature,
    );
  }
}
