import "dotenv/config";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { seedDatabase } from "./seed-data.js";

// This opt-in fixture command never runs during hosted startup.
if (
  process.env.NODE_ENV === "production" ||
  process.env.DATABASE_URL !== "file:./dev.db"
) {
  throw new Error(
    "seed:local requires the local file:./dev.db database and a non-production environment.",
  );
}
const db = new PrismaClient();
const samples = [
  {
    label: "Sample Home",
    contactName: "Ananya Sharma",
    addressLine1: "Flat 204, Ashoka Residency, 18 Museum Road",
    addressLine2: "Second floor, near the main entrance",
    city: "Bengaluru",
    state: "Karnataka",
    postalCode: "560001",
  },
  {
    label: "Sample Apartment",
    contactName: "Rohan Mehta",
    addressLine1: "Flat 302, Maple Court, 6th Cross, Koramangala",
    addressLine2: "Third floor, Block B",
    city: "Bengaluru",
    state: "Karnataka",
    postalCode: "560034",
  },
  {
    label: "Sample Family Home",
    contactName: "Priya Nair",
    addressLine1: "24, Garden View, Sayyaji Rao Road",
    addressLine2: "Ground floor",
    city: "Mysuru",
    state: "Karnataka",
    postalCode: "570001",
  },
];
function fixtureId(userId: string, label: string) {
  const hex = createHash("sha256")
    .update("loop-local-address-v1:" + userId + ":" + label)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
try {
  const users = await db.user.findMany({ select: { id: true, phone: true } });
  if (!users.length)
    throw new Error(
      "Sign into the local app once, then rerun npm run seed:local.",
    );
  const before = {
    addresses: await db.userAddress.count(),
    slots: await db.providerAvailabilitySlot.count(),
    bookings: await db.booking.count(),
    payments: await db.payment.count(),
  };
  await seedDatabase(db);
  await db.$transaction(
    async (tx) => {
      for (const user of users)
        for (const sample of samples) {
          const id = fixtureId(user.id, sample.label);
          const existing = await tx.userAddress.findUnique({ where: { id } });
          if (existing) {
            if (existing.userId !== user.id)
              throw new Error(
                "Fixture ownership conflict; no addresses committed.",
              );
            continue; // Preserve edits to an existing sample address.
          }
          await tx.userAddress.create({
            data: {
              id,
              userId: user.id,
              ...sample,
              contactPhone: /^\+91[6-9]\d{9}$/.test(user.phone)
                ? user.phone
                : "+919000000001",
            },
          });
        }
    },
    { timeout: 120000 },
  );
  const bookings = await db.booking.count(),
    payments = await db.payment.count();
  if (bookings !== before.bookings || payments !== before.payments)
    throw new Error(
      "Booking/payment counts changed during seeding; check for concurrent app activity.",
    );
  for (const user of users) {
    const count = await db.userAddress.count({
      where: {
        userId: user.id,
        id: { in: samples.map((sample) => fixtureId(user.id, sample.label)) },
      },
    });
    if (count !== samples.length)
      throw new Error("Address ownership verification failed.");
  }
  console.table({
    "Local accounts supplied with addresses": { count: users.length },
    "New addresses": {
      count: (await db.userAddress.count()) - before.addresses,
    },
    Providers: { count: await db.serviceProvider.count() },
    "New slots": {
      count: (await db.providerAvailabilitySlot.count()) - before.slots,
    },
    "Future available slots": {
      count: await db.providerAvailabilitySlot.count({
        where: { status: "AVAILABLE", startAt: { gt: new Date() } },
      }),
    },
    "Bookings preserved": { count: bookings },
    "Payments preserved": { count: payments },
  });
  console.log(
    "Fictional sample addresses are owned separately by each existing local account. Refresh Addresses or Ask Loop; choose Sample Home and Tomorrow. Rerun after creating a new account. No cloud data was changed.",
  );
} finally {
  await db.$disconnect();
}
