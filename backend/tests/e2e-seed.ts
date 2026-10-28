import { PrismaClient } from "@prisma/client";
import { seedDatabase } from "../prisma/seed-data.js";
if (!process.env.DATABASE_URL?.endsWith("e2e.db"))
  throw new Error("Refusing to reset a non-E2E database.");
const db = new PrismaClient();
try {
  await db.providerAvailabilitySlot.updateMany({
    data: {
      status: "AVAILABLE",
      activeBookingId: null,
      heldByUserId: null,
      holdExpiresAt: null,
    },
  });
  await db.webhookEvent.deleteMany();
  await db.payment.deleteMany();
  await db.bookingWasteType.deleteMany();
  await db.booking.deleteMany();
  await db.userAddress.deleteMany();
  await db.refreshToken.deleteMany();
  await db.user.deleteMany();
  await db.otpChallenge.deleteMany();
  await seedDatabase(db);
} finally {
  await db.$disconnect();
}
