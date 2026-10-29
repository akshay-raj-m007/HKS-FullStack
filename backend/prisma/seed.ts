import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { seedDatabase } from "./seed-data.js";
const db = new PrismaClient();
try {
  const before = await db.providerAvailabilitySlot.count();
  console.log(
    "Seeded " +
      (await seedDatabase(db)) +
      " providers with future availability.",
  );
  const after = await db.providerAvailabilitySlot.count();
  console.table({
    "Providers in catalog": { count: await db.serviceProvider.count() },
    "New slots inserted": { count: after - before },
    "Future available slots": {
      count: await db.providerAvailabilitySlot.count({
        where: { status: "AVAILABLE", startAt: { gt: new Date() } },
      }),
    },
  });
  console.log(
    "Coverage: Bengaluru 560001, 560034, 560038; Mysuru 570001 (varies by provider). Tomorrow at 560001 supports Paper, Food and Green waste. Existing reservations are preserved.",
  );
} finally {
  await db.$disconnect();
}
