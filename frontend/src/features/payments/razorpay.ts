import type { Payment } from "../../types";
export interface PaymentProof {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}
interface Checkout {
  open(): void;
  close(): void;
  on(event: "payment.failed", callback: () => void): void;
}
interface Options {
  key: string;
  amount: number;
  currency: string;
  order_id: string;
  name: string;
  description: string;
  handler: (proof: PaymentProof) => void;
  modal: { ondismiss: () => void };
  theme: { color: string };
}
declare global {
  interface Window {
    Razorpay?: new (options: Options) => Checkout;
  }
}
let scriptPromise: Promise<void> | null = null;
function load() {
  if (window.Razorpay) return Promise.resolve();
  if (!scriptPromise)
    scriptPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.onload = () => {
        script.onload = null;
        script.onerror = null;
        resolve();
      };
      script.onerror = () => {
        script.onload = null;
        script.onerror = null;
        scriptPromise = null;
        script.remove();
        reject(
          new Error("Could not load Razorpay Checkout. Check your connection."),
        );
      };
      document.head.appendChild(script);
    });
  return scriptPromise;
}
export async function openRazorpay(
  payment: Payment,
  signal?: AbortSignal,
): Promise<PaymentProof> {
  signal?.throwIfAborted();
  await load();
  signal?.throwIfAborted();
  if (!window.Razorpay) throw new Error("Razorpay Checkout is unavailable.");
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (proof?: PaymentProof, error?: Error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      if (proof) resolve(proof);
      else reject(error);
    };
    const abort = () => {
      finish(
        undefined,
        new DOMException("Checkout navigation cancelled.", "AbortError"),
      );
      checkout.close();
    };
    const checkout = new window.Razorpay!({
      key: payment.keyId!,
      amount: payment.amount,
      currency: payment.currency,
      order_id: payment.providerOrderId,
      name: "Loop",
      description: "Waste collection · test payment",
      handler: (proof) => finish(proof),
      modal: {
        ondismiss: () =>
          finish(
            undefined,
            new Error(
              "Checkout closed. Your slot remains held until its timer expires.",
            ),
          ),
      },
      theme: { color: "#244f3e" },
    });
    signal?.addEventListener("abort", abort, { once: true });
    try {
      checkout.open();
    } catch (error) {
      finish(
        undefined,
        error instanceof Error ? error : new Error("Could not open Checkout."),
      );
    }
  });
}
