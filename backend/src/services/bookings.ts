import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db, transaction } from "../repositories/db.js";
import { owned, bookingInclude } from "../repositories/owned.js";
import { holdSchema } from "../validators/schemas.js";
import { env } from "../config/env.js";
import { expireInTransaction, expireHolds } from "../jobs/expiry.js";
import { hash } from "../utils/crypto.js";
import { assert, AppError } from "../utils/errors.js";
export async function holdBooking(
  userId: string,
  input: z.infer<typeof holdSchema>,
  idempotencyKey: string,
) {
  const requestHash = hash(
    JSON.stringify({ ...input, wasteTypes: [...input.wasteTypes].sort() }),
  );
  try {
    return await transaction(async (tx) => {
      await expireInTransaction(tx);
      const existing = await tx.booking.findFirst({
        where: { userId, idempotencyKey },
        include: bookingInclude,
      });
      if (existing) {
        assert(
          existing.requestHash === requestHash,
          409,
          "IDEMPOTENCY_CONFLICT",
          "This request key was already used for another booking.",
        );
        return existing;
      }
      const address = await owned.address(userId, input.addressId, tx);
      const provider = await tx.serviceProvider.findFirst({
        where: { id: input.providerId, active: true },
        include: { wasteTypes: true, serviceAreas: true },
      });
      assert(provider, 404, "NOT_FOUND", "Provider was not found.");
      assert(
        input.wasteTypes.every((w) =>
          provider.wasteTypes.some((p) => p.wasteType === w),
        ),
        400,
        "UNSUPPORTED_WASTE",
        "This provider does not collect the selected waste.",
      );
      assert(
        provider.serviceAreas.some(
          (a) =>
            a.postalCode === address.postalCode &&
            a.city.toLowerCase() === address.city.toLowerCase(),
        ),
        400,
        "UNSUPPORTED_LOCATION",
        "This provider does not serve your address.",
      );
      const holdExpiresAt = new Date(Date.now() + env.HOLD_MINUTES * 60000);
      const claimed = await tx.providerAvailabilitySlot.updateMany({
        where: {
          id: input.slotId,
          providerId: provider.id,
          status: "AVAILABLE",
          startAt: { gt: holdExpiresAt },
        },
        data: { status: "HELD", heldByUserId: userId, holdExpiresAt },
      });
      assert(
        claimed.count === 1,
        409,
        "SLOT_NOT_AVAILABLE",
        "The selected slot is no longer available. Please choose another.",
      );
      const slot = await tx.providerAvailabilitySlot.findUniqueOrThrow({
        where: { id: input.slotId },
      });
      const {
        id: _id,
        userId: _owner,
        createdAt: _created,
        updatedAt: _updated,
        ...snapshot
      } = address;
      const booking = await tx.booking.create({
        data: {
          userId,
          providerId: provider.id,
          slotId: slot.id,
          addressId: address.id,
          providerName: provider.name,
          addressSnapshot: snapshot,
          amount: provider.price,
          currency: provider.currency,
          startAt: slot.startAt,
          endAt: slot.endAt,
          holdExpiresAt,
          idempotencyKey,
          requestHash,
          wasteTypes: {
            create: input.wasteTypes.map((wasteType) => ({ wasteType })),
          },
        },
        include: bookingInclude,
      });
      await tx.providerAvailabilitySlot.update({
        where: { id: slot.id },
        data: { activeBookingId: booking.id },
      });
      return booking;
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await db.booking.findFirst({
        where: { userId, idempotencyKey },
        include: bookingInclude,
      });
      if (existing && existing.requestHash === requestHash) return existing;
      throw new AppError(
        409,
        "IDEMPOTENCY_CONFLICT",
        "The request conflicts with an existing booking.",
      );
    }
    throw error;
  }
}
export async function listBookings(userId: string) {
  await expireHolds();
  return db.booking.findMany({
    where: { userId },
    include: bookingInclude,
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}
export async function getBooking(userId: string, id: string) {
  await expireHolds();
  return owned.booking(userId, id);
}
export async function cancelBooking(userId: string, id: string) {
  return transaction(async (tx) => {
    const booking = await owned.booking(userId, id, tx);
    if (booking.status === "CANCELLED") return booking;
    assert(
      ["PENDING_PAYMENT", "PAYMENT_PROCESSING"].includes(booking.status),
      409,
      "INVALID_STATE",
      "Only unpaid reservations can be cancelled.",
    );
    await tx.booking.updateMany({
      where: {
        id,
        userId,
        status: { in: ["PENDING_PAYMENT", "PAYMENT_PROCESSING"] },
      },
      data: { status: "CANCELLED" },
    });
    await tx.providerAvailabilitySlot.updateMany({
      where: {
        id: booking.slotId,
        activeBookingId: id,
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
    return owned.booking(userId, id, tx);
  });
}
