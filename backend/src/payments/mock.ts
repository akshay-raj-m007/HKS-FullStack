import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { hmac, safeEqual } from "../utils/crypto.js";
import { AppError } from "../utils/errors.js";
import type { PaymentProvider, CapturedPayment } from "./provider.js";
export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock" as const;
  readonly publicKey = "mock";
  private payments = new Map<string, CapturedPayment>();
  async createOrder(input: {
    amount: number;
    currency: string;
    receipt: string;
  }) {
    return {
      id: "order_mock_" + input.receipt,
      amount: input.amount,
      currency: input.currency,
    };
  }
  verifySignature(orderId: string, paymentId: string, signature: string) {
    return safeEqual(
      hmac(orderId + "|" + paymentId, env.OTP_HASH_SECRET),
      signature,
    );
  }
  async fetchPayment(id: string) {
    const p = this.payments.get(id);
    if (!p)
      throw new AppError(
        400,
        "INVALID_PAYMENT",
        "Mock payment was not captured.",
      );
    return p;
  }
  capture(orderId: string, amount: number, currency: string) {
    const id = "pay_mock_" + randomUUID();
    this.payments.set(id, { id, orderId, amount, currency, captured: true });
    return {
      razorpay_order_id: orderId,
      razorpay_payment_id: id,
      razorpay_signature: hmac(orderId + "|" + id, env.OTP_HASH_SECRET),
    };
  }
  verifyWebhook(raw: Buffer, signature: string) {
    return safeEqual(
      hmac(raw.toString("utf8"), env.OTP_HASH_SECRET),
      signature,
    );
  }
}
