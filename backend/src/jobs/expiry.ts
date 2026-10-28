import { Prisma } from "@prisma/client";
import { transaction } from "../repositories/db.js";
export async function expireInTransaction(
  tx: Prisma.TransactionClient,
  now = new Date(),
) {
  await tx.booking.updateMany({
    where: {
      status: { in: ["PENDING_PAYMENT", "PAYMENT_PROCESSING"] },
      holdExpiresAt: { lte: now },
    },
    data: { status: "EXPIRED" },
  });
  await tx.providerAvailabilitySlot.updateMany({
    where: { status: "HELD", holdExpiresAt: { lte: now } },
    data: {
      status: "AVAILABLE",
      heldByUserId: null,
      holdExpiresAt: null,
      activeBookingId: null,
    },
  });
}
export const expireHolds = () => transaction((tx) => expireInTransaction(tx));
