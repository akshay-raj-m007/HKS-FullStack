import { afterEach, describe, expect, it, vi } from "vitest";
import { openRazorpay, type PaymentProof } from "../features/payments/razorpay";
import type { Payment } from "../types";

const payment: Payment = {
  id: "payment-a",
  provider: "razorpay",
  providerOrderId: "order-a",
  status: "CREATED",
  amount: 14900,
  currency: "INR",
  keyId: "rzp_test_public",
};
afterEach(() => {
  delete window.Razorpay;
});

describe("payment modal navigation cleanup", () => {
  it("closes the checkout and rejects its promise when leaving the page", async () => {
    const close = vi.fn();
    window.Razorpay = class {
      open() {}
      close = close;
      on() {}
    };
    const controller = new AbortController();
    const result = openRazorpay(payment, controller.signal);
    const rejected = expect(result).rejects.toMatchObject({
      name: "AbortError",
    });
    await Promise.resolve();
    controller.abort();
    await rejected;
    expect(close).toHaveBeenCalledOnce();
  });

  it("removes the abort listener after payment succeeds", async () => {
    const close = vi.fn();
    let complete!: (proof: PaymentProof) => void;
    window.Razorpay = class {
      constructor(options: { handler: (proof: PaymentProof) => void }) {
        complete = options.handler;
      }
      open() {}
      close = close;
      on() {}
    };
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const result = openRazorpay(payment, controller.signal);
    await Promise.resolve();
    const proof = {
      razorpay_order_id: "order-a",
      razorpay_payment_id: "pay-a",
      razorpay_signature: "proof",
    };
    complete(proof);
    await expect(result).resolves.toEqual(proof);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    controller.abort();
    expect(close).not.toHaveBeenCalled();
  });
});
