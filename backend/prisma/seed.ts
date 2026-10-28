import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { seedDatabase } from "./seed-data.js";
const db = new PrismaClient();
try {
  console.log(
    "Seeded " +
      (await seedDatabase(db)) +
      " providers with future availability.",
  );
} finally {
  await db.$disconnect();
}
