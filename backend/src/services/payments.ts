import { z } from "zod";
import { db, transaction } from "../repositories/db.js";
import { owned } from "../repositories/owned.js";
import { assert, AppError } from "../utils/errors.js";
import type { PaymentProvider, CapturedPayment } from "../payments/provider.js";
import { MockPaymentProvider } from "../payments/mock.js";
import { verifyPaymentSchema } from "../validators/schemas.js";
import { hash } from "../utils/crypto.js";
import { expireInTransaction, expireHolds } from "../jobs/expiry.js";
const eventSchema = z.object({
  event: z.string(),
  payload: z.object({
    payment: z.object({
      entity: z.object({
        id: z.string(),
        order_id: z.string(),
        amount: z.number().int(),
        currency: z.string(),
        status: z.string(),
      }),
    }),
  }),
});
export class PaymentService {
  constructor(public gateway: PaymentProvider) {}
  async create(userId: string, bookingId: string) {
    await expireHolds();
    const reserved = await transaction(async (tx) => {
      const booking = await owned.booking(userId, bookingId, tx);
      assert(
        ["PENDING_PAYMENT", "PAYMENT_PROCESSING"].includes(booking.status) &&
          booking.holdExpiresAt > new Date(),
        409,
        "HOLD_EXPIRED",
        "This reservation is no longer payable.",
      );
      assert(
        !booking.payment || booking.payment.provider === this.gateway.name,
        409,
        "PAYMENT_PROVIDER_CHANGED",
        "This reservation used a different payment provider. Cancel it and create a new pickup.",
      );
      if (booking.payment?.providerOrderId)
        return { payment: booking.payment, create: false };
      assert(
        !booking.payment?.creationStartedAt,
        409,
        "PAYMENT_CREATION_PENDING",
        "An order request is already being processed. Refresh shortly. If it remains pending, let this hold expire.",
      );
      const payment = await tx.payment.upsert({
        where: { bookingId },
        create: {
          bookingId,
          provider: this.gateway.name,
          amount: booking.amount,
          currency: booking.currency,
          creationStartedAt: new Date(),
        },
        update: { creationStartedAt: new Date() },
      });
      await tx.booking.updateMany({
        where: { id: bookingId, userId },
        data: { status: "PAYMENT_PROCESSING" },
      });
      return { payment, create: true };
    });
    if (!reserved.create)
      return { ...reserved.payment, keyId: this.gateway.publicKey };
    // No external network calls inside SQLite transactions. A durable creation marker
    // prevents duplicate remote orders after uncertain network failures.
    const order = await this.gateway.createOrder({
      amount: reserved.payment.amount,
      currency: reserved.payment.currency,
      receipt: reserved.payment.id,
    });
    assert(
      order.amount === reserved.payment.amount &&
        order.currency === reserved.payment.currency,
      502,
      "GATEWAY_MISMATCH",
      "Gateway order did not match the requested amount.",
    );
    await db.payment.updateMany({
      where: {
        id: reserved.payment.id,
        booking: { userId },
        providerOrderId: null,
      },
      data: { providerOrderId: order.id },
    });
    return {
      ...(await owned.payment(userId, reserved.payment.id)),
      keyId: this.gateway.publicKey,
    };
  }
  async verify(userId: string, input: z.infer<typeof verifyPaymentSchema>) {
    const booking = await owned.booking(userId, input.bookingId);
    const payment = booking.payment;
    assert(
      payment?.providerOrderId === input.razorpay_order_id,
      400,
      "INVALID_PAYMENT",
      "Payment order does not match this reservation.",
    );
    assert(
      this.gateway.verifySignature(
        payment.providerOrderId,
        input.razorpay_payment_id,
        input.razorpay_signature,
      ),
      400,
      "INVALID_SIGNATURE",
      "Payment signature could not be verified.",
    );
    if (payment.status === "PAID") {
      assert(
        payment.providerPaymentId === input.razorpay_payment_id,
        409,
        "PAYMENT_CONFLICT",
        "This order already has a different payment.",
      );
      return booking;
    }
    const captured = await this.gateway.fetchPayment(input.razorpay_payment_id);
    assert(
      captured.captured,
      409,
      "PAYMENT_NOT_CAPTURED",
      "Payment is awaiting capture. Check your orders shortly.",
    );
    await this.settle(payment.id, captured);
    return owned.booking(userId, booking.id);
  }
  async settle(
    paymentId: string,
    captured: CapturedPayment,
    eventKey?: string,
  ) {
    return transaction(async (tx) => {
      if (
        eventKey &&
        (await tx.webhookEvent.findUnique({ where: { eventKey } }))
      )
        return;
      const payment = await tx.payment.findUniqueOrThrow({
        where: { id: paymentId },
        include: { booking: true },
      });
      assert(
        captured.captured &&
          captured.orderId === payment.providerOrderId &&
          captured.amount === payment.amount &&
          captured.currency === payment.currency,
        400,
        "INVALID_PAYMENT",
        "Payment details do not match.",
      );
      if (payment.status === "PAID" || payment.status === "REFUND_REQUIRED") {
        assert(
          payment.providerPaymentId === captured.id,
          409,
          "PAYMENT_CONFLICT",
          "A different payment is already recorded.",
        );
      } else {
        await expireInTransaction(tx);
        const booked = await tx.providerAvailabilitySlot.updateMany({
          where: {
            id: payment.booking.slotId,
            activeBookingId: payment.bookingId,
            heldByUserId: payment.booking.userId,
            status: "HELD",
            holdExpiresAt: { gt: new Date() },
          },
          data: { status: "BOOKED", heldByUserId: null, holdExpiresAt: null },
        });
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: booked.count ? "PAID" : "REFUND_REQUIRED",
            providerPaymentId: captured.id,
          },
        });
        if (booked.count)
          await tx.booking.updateMany({
            where: {
              id: payment.bookingId,
              userId: payment.booking.userId,
              status: { in: ["PENDING_PAYMENT", "PAYMENT_PROCESSING"] },
            },
            data: { status: "PROCESSING" },
          });
      }
      if (eventKey) await tx.webhookEvent.create({ data: { eventKey } });
    });
  }
  async mock(
    userId: string,
    bookingId: string,
    outcome: "success" | "failure",
  ) {
    assert(
      this.gateway instanceof MockPaymentProvider,
      404,
      "NOT_FOUND",
      "This endpoint is unavailable.",
    );
    const booking = await owned.booking(userId, bookingId);
    if (booking.payment?.status === "PAID") return booking;
    assert(
      booking.payment?.providerOrderId,
      409,
      "PAYMENT_NOT_CREATED",
      "Create a payment order first.",
    );
    if (outcome === "failure") {
      await transaction(async (tx) => {
        const current = await owned.booking(userId, bookingId, tx);
        assert(
          ["PENDING_PAYMENT", "PAYMENT_PROCESSING"].includes(current.status),
          409,
          "INVALID_STATE",
          "This reservation is no longer payable.",
        );
        await tx.payment.updateMany({
          where: { bookingId, booking: { userId }, status: "CREATED" },
          data: { status: "FAILED" },
        });
        await tx.booking.updateMany({
          where: { id: bookingId, userId },
          data: { status: "PAYMENT_FAILED" },
        });
        await tx.providerAvailabilitySlot.updateMany({
          where: {
            activeBookingId: bookingId,
            heldByUserId: userId,
            status: "HELD",
          },
          data: {
            status: "AVAILABLE",
            heldByUserId: null,
            holdExpiresAt: null,
            activeBookingId: null,
          },
        });
      });
      return owned.booking(userId, bookingId);
    }
    const proof = this.gateway.capture(
      booking.payment.providerOrderId,
      booking.amount,
      booking.currency,
    );
    return this.verify(userId, { bookingId, ...proof });
  }
  async webhook(raw: Buffer, signature: string, eventId?: string) {
    assert(
      this.gateway.verifyWebhook(raw, signature),
      400,
      "INVALID_SIGNATURE",
      "Webhook signature could not be verified.",
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString("utf8"));
    } catch {
      throw new AppError(400, "INVALID_PAYLOAD", "Invalid webhook payload.");
    }
    const event = eventSchema.safeParse(parsed);
    if (!event.success)
      throw new AppError(400, "INVALID_PAYLOAD", "Invalid webhook payload.");
    const key =
      this.gateway.name + ":" + (eventId ?? hash(raw.toString("utf8")));
    if (await db.webhookEvent.findUnique({ where: { eventKey: key } })) return;
    const entity = event.data.payload.payment.entity;
    if (!["payment.captured", "payment.failed"].includes(event.data.event))
      return;
    const payment = await db.payment.findUnique({
      where: { providerOrderId: entity.order_id },
    });
    assert(payment, 404, "NOT_FOUND", "Payment order not found.");
    if (event.data.event === "payment.captured") {
      assert(
        entity.status === "captured",
        400,
        "INVALID_PAYMENT",
        "Expected captured payment.",
      );
      // Confirm gateway state as well as signed webhook contents.
      const captured = await this.gateway.fetchPayment(entity.id);
      await this.settle(payment.id, captured, key);
    } else {
      // A failed attempt may be retried in Checkout. Retain the hold until expiry;
      // do not downgrade a paid order or treat one failed attempt as final.
      await db.webhookEvent.upsert({
        where: { eventKey: key },
        create: { eventKey: key },
        update: {},
      });
    }
  }
}
