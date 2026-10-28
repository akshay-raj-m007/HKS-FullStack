export interface GatewayOrder {
  id: string;
  amount: number;
  currency: string;
}
export interface CapturedPayment {
  id: string;
  orderId: string;
  amount: number;
  currency: string;
  captured: boolean;
}
export interface PaymentProvider {
  readonly name: "mock" | "razorpay";
  readonly publicKey: string;
  createOrder(input: {
    amount: number;
    currency: string;
    receipt: string;
  }): Promise<GatewayOrder>;
  verifySignature(
    orderId: string,
    paymentId: string,
    signature: string,
  ): boolean;
  fetchPayment(paymentId: string): Promise<CapturedPayment>;
  verifyWebhook(raw: Buffer, signature: string): boolean;
}
