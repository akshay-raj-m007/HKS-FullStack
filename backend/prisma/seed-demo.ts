import "dotenv/config";
import {
  BookingStatus,
  PaymentStatus,
  Prisma,
  PrismaClient,
  SlotStatus,
  WasteType,
} from "@prisma/client";
import { seedDatabase } from "./seed-data.js";

/**
 * Deterministic IDs are the ownership marker for this fixture set. Cleanup below
 * only ever touches these IDs, so real accounts and bookings are left alone.
 */
const fixtures = [
  {
    userId: "d0000000-0000-4000-8000-000000000001",
    phone: "+910000000001",
    name: "Ananya Sharma",
    addressId: "d1000000-0000-4000-8000-000000000001",
    label: "Home",
    addressLine1: "14, 3rd Cross, Indiranagar",
    addressLine2: "Near 100 Feet Road",
    city: "Bengaluru",
    state: "Karnataka",
    postalCode: "560038",
    latitude: 12.9719,
    longitude: 77.6412,
  },
  {
    userId: "d0000000-0000-4000-8000-000000000002",
    phone: "+910000000002",
    name: "Rohan Mehta",
    addressId: "d1000000-0000-4000-8000-000000000002",
    label: "Apartment",
    addressLine1: "42, 5th Main, HSR Layout",
    addressLine2: "Sector 2",
    city: "Bengaluru",
    state: "Karnataka",
    postalCode: "560034",
    latitude: 12.9116,
    longitude: 77.6389,
  },
  {
    userId: "d0000000-0000-4000-8000-000000000003",
    phone: "+910000000003",
    name: "Priya Nair",
    addressId: "d1000000-0000-4000-8000-000000000003",
    label: "Residence",
    addressLine1: "8, Kuvempu Nagar",
    addressLine2: "Vijayanagar",
    city: "Mysuru",
    state: "Karnataka",
    postalCode: "570001",
    latitude: 12.2958,
    longitude: 76.6394,
  },
  {
    userId: "d0000000-0000-4000-8000-000000000004",
    phone: "+910000000004",
    name: "Kabir Khan",
    addressId: "d1000000-0000-4000-8000-000000000004",
    label: "House",
    addressLine1: "27, 2nd Cross, Malleshwaram",
    addressLine2: "Near Sampige Road",
    city: "Bengaluru",
    state: "Karnataka",
    postalCode: "560001",
    latitude: 13.0031,
    longitude: 77.5704,
  },
] as const;

const bookingFixtures: {
  id: string;
  userIndex: number;
  providerName: string;
  wasteTypes: WasteType[];
  status: BookingStatus;
  paymentStatus?: PaymentStatus;
  daysFromNow: number;
  hour: number;
}[] = [
  {
    id: "d2000000-0000-4000-8000-000000000001",
    userIndex: 0,
    providerName: "GreenCycle Services",
    wasteTypes: ["PAPER", "PLASTIC"],
    status: "COMPLETED",
    paymentStatus: "PAID",
    daysFromNow: -5,
    hour: 9,
  },
  {
    id: "d2000000-0000-4000-8000-000000000002",
    userIndex: 0,
    providerName: "EcoFood Collect",
    wasteTypes: ["FOOD", "GREEN_WASTE"],
    status: "PENDING_PAYMENT",
    daysFromNow: 2,
    hour: 12,
  },
  {
    id: "d2000000-0000-4000-8000-000000000003",
    userIndex: 1,
    providerName: "Everyday Earth",
    wasteTypes: ["GENERAL", "ELECTRONIC"],
    status: "CANCELLED",
    paymentStatus: "FAILED",
    daysFromNow: 3,
    hour: 14,
  },
  {
    id: "d2000000-0000-4000-8000-000000000004",
    userIndex: 2,
    providerName: "Urban Recycling",
    wasteTypes: ["ELECTRONIC"],
    status: "COMPLETED",
    paymentStatus: "PAID",
    daysFromNow: -12,
    hour: 11,
  },
  {
    id: "d2000000-0000-4000-8000-000000000005",
    userIndex: 3,
    providerName: "Paper Trail",
    wasteTypes: ["PAPER"],
    status: "PAYMENT_FAILED",
    paymentStatus: "FAILED",
    daysFromNow: 4,
    hour: 14,
  },
  {
    id: "d2000000-0000-4000-8000-000000000006",
    userIndex: 1,
    providerName: "GreenCycle Services",
    wasteTypes: ["PLASTIC", "GREEN_WASTE"],
    status: "EXPIRED",
    daysFromNow: -2,
    hour: 15,
  },
];

const prisma = new PrismaClient();
const counts: Record<string, number> = {};
const ids = {
  users: fixtures.map((f) => f.userId),
  addresses: fixtures.map((f) => f.addressId),
  bookings: bookingFixtures.map((f) => f.id),
  slots: bookingFixtures.map((f) => `d3000000-0000-4000-8000-${f.id.slice(-12)}`),
  bookingWasteTypes: bookingFixtures.flatMap((f) =>
    f.wasteTypes.map((_, index) => `d4000000-0000-4000-8000-${f.id.slice(-12, -1)}${index + 1}`),
  ),
  payments: bookingFixtures.flatMap((f) =>
    f.paymentStatus ? [`d5000000-0000-4000-8000-${f.id.slice(-12)}`] : [],
  ),
};

async function clearPreviousFixtures(tx: Prisma.TransactionClient) {
  // A prior interrupted run may have left a slot state set before a row was
  // removed. Release only this seed's known slots before deleting dependencies.
  await tx.providerAvailabilitySlot.updateMany({
    where: { id: { in: ids.slots } },
    data: {
      status: SlotStatus.AVAILABLE,
      heldByUserId: null,
      holdExpiresAt: null,
      activeBookingId: null,
    },
  });
  await tx.payment.deleteMany({ where: { id: { in: ids.payments } } });
  await tx.bookingWasteType.deleteMany({
    where: { id: { in: ids.bookingWasteTypes } },
  });
  await tx.booking.deleteMany({ where: { id: { in: ids.bookings } } });
  await tx.providerAvailabilitySlot.deleteMany({ where: { id: { in: ids.slots } } });
  await tx.userAddress.deleteMany({ where: { id: { in: ids.addresses } } });
  await tx.providerAvailabilitySlot.updateMany({
    where: { heldByUserId: { in: ids.users } },
    data: {
      status: SlotStatus.AVAILABLE,
      heldByUserId: null,
      holdExpiresAt: null,
      activeBookingId: null,
    },
  });
  await tx.user.deleteMany({ where: { id: { in: ids.users } } });
}

function localDateOffset(days: number) {
  const now = new Date();
  const localDate = new Date(now.getTime() + 19800000);
  localDate.setUTCHours(0, 0, 0, 0);
  return new Date(localDate.getTime() + days * 86400000);
}

try {
  const before = {
    providers: await prisma.serviceProvider.count(),
    providerWasteTypes: await prisma.providerWasteType.count(),
    providerServiceAreas: await prisma.providerServiceArea.count(),
    slots: await prisma.providerAvailabilitySlot.count(),
  };
  await seedDatabase(prisma);
  counts.ServiceProvider = (await prisma.serviceProvider.count()) - before.providers;
  counts.ProviderWasteType = (await prisma.providerWasteType.count()) - before.providerWasteTypes;
  counts.ProviderServiceArea = (await prisma.providerServiceArea.count()) - before.providerServiceAreas;
  counts.ProviderAvailabilitySlot = (await prisma.providerAvailabilitySlot.count()) - before.slots;
  counts.OtpChallenge = 0;
  counts.RefreshToken = 0;
  counts.WebhookEvent = 0;

  await prisma.$transaction(async (tx) => {
    await clearPreviousFixtures(tx);

    for (const fixture of fixtures) {
      await tx.user.create({
        data: { id: fixture.userId, phone: fixture.phone },
      });
      counts.User = (counts.User ?? 0) + 1;
      await tx.userAddress.create({
        data: {
          id: fixture.addressId,
          userId: fixture.userId,
          label: fixture.label,
          contactName: fixture.name,
          contactPhone: fixture.phone,
          addressLine1: fixture.addressLine1,
          addressLine2: fixture.addressLine2,
          city: fixture.city,
          state: fixture.state,
          postalCode: fixture.postalCode,
          latitude: fixture.latitude,
          longitude: fixture.longitude,
        },
      });
      counts.UserAddress = (counts.UserAddress ?? 0) + 1;
    }

    // Create every available slot before any booking points to one. Booking
    // and activeBookingId form a cycle, so the active link is set later.
    for (const [index, fixture] of bookingFixtures.entries()) {
      const provider = await tx.serviceProvider.findUniqueOrThrow({
        where: { name: fixture.providerName },
      });
      const startAt = localDateOffset(fixture.daysFromNow);
      startAt.setUTCHours(fixture.hour - 6, 30, 0, 0);
      const endAt = new Date(startAt.getTime() + 3600000);
      const slotId = ids.slots[index]!;
      try {
        await tx.providerAvailabilitySlot.create({
          data: { id: slotId, providerId: provider.id, startAt, endAt },
        });
      } catch (error) {
        console.error("Failed slot fixture", index + 1, fixture.providerName, startAt.toISOString());
        throw error;
      }
      counts.ProviderAvailabilitySlot++;
    }

    for (const [index, fixture] of bookingFixtures.entries()) {
      const user = fixtures[fixture.userIndex]!;
      const provider = await tx.serviceProvider.findUniqueOrThrow({
        where: { name: fixture.providerName },
      });
      const slotId = ids.slots[index]!;
      const slot = await tx.providerAvailabilitySlot.findUniqueOrThrow({
        where: { id: slotId },
      });
      const { startAt, endAt } = slot;
      const bookingId = fixture.id;
      const holdExpiresAt = new Date(Date.now() + 10 * 60000);
      const bookingCreatedAt = fixture.status === "PENDING_PAYMENT"
        ? new Date(Date.now() - 2 * 60000)
        : fixture.daysFromNow > 0
          ? new Date(Date.now() - (index + 1) * 3600000)
          : new Date(startAt.getTime() - 86400000);

      const address = await tx.userAddress.findUniqueOrThrow({
        where: { id: user.addressId },
      });
      const { id: _id, userId: _userId, createdAt: _createdAt, updatedAt: _updatedAt, ...snapshot } = address;
      await tx.booking.create({
        data: {
          id: bookingId,
          userId: user.userId,
          providerId: provider.id,
          slotId,
          addressId: address.id,
          providerName: provider.name,
          addressSnapshot: snapshot,
          startAt,
          endAt,
          amount: provider.price,
          currency: provider.currency,
          status: fixture.status,
          holdExpiresAt: fixture.status === "PENDING_PAYMENT"
            ? holdExpiresAt
            : new Date(bookingCreatedAt.getTime() + 10 * 60000),
          idempotencyKey: `demo-seed-${index + 1}`,
          requestHash: `demo-fixture-${index + 1}`,
          createdAt: bookingCreatedAt,
          wasteTypes: { create: fixture.wasteTypes.map((wasteType) => ({ wasteType })) },
        },
      });
      counts.Booking = (counts.Booking ?? 0) + 1;
      counts.BookingWasteType = (counts.BookingWasteType ?? 0) + fixture.wasteTypes.length;

      if (fixture.paymentStatus === "PAID") {
        await tx.providerAvailabilitySlot.update({
          where: { id: slotId },
          data: { status: SlotStatus.BOOKED, activeBookingId: bookingId },
        });
      } else if (fixture.status === "PENDING_PAYMENT") {
        await tx.providerAvailabilitySlot.update({
          where: { id: slotId },
          data: {
            status: SlotStatus.HELD,
            heldByUserId: user.userId,
            holdExpiresAt,
            activeBookingId: bookingId,
          },
        });
      }

      if (fixture.paymentStatus) {
        const paymentId = ids.payments[bookingFixtures
          .slice(0, index + 1)
          .filter((candidate) => candidate.paymentStatus).length - 1]!;
        const paymentState = fixture.paymentStatus;
        const timestamp = new Date(bookingCreatedAt.getTime() + 5 * 60000);
        await tx.payment.create({
          data: {
            id: paymentId,
            bookingId,
            provider: "mock",
            providerOrderId: `order_demo_${index + 1}`,
            providerPaymentId: paymentState === "PAID" ? `pay_demo_${index + 1}` : null,
            amount: provider.price,
            currency: provider.currency,
            status: paymentState,
            creationStartedAt: timestamp,
            createdAt: timestamp,
          },
        });
        counts.Payment = (counts.Payment ?? 0) + 1;
      }
    }
  }, { timeout: 30000 });

  console.log("\nDemo seed complete (only this script's deterministic fixture IDs are replaced).\n");
  console.log("Table                         Rows inserted this run");
  console.log("----------------------------  ----------------------");
  for (const table of [
    "User", "UserAddress", "OtpChallenge", "RefreshToken", "ServiceProvider",
    "ProviderWasteType", "ProviderServiceArea", "ProviderAvailabilitySlot",
    "Booking", "BookingWasteType", "Payment", "WebhookEvent",
  ]) {
    console.log(`${table.padEnd(28)}  ${String(counts[table] ?? 0).padStart(13)}`);
  }
  console.log("\nSynthetic account phone numbers are intentionally invalid and cannot receive OTPs.");
} catch (error) {
  console.error(
    "Demo fixture transaction failed. Provider catalog seeding may already have completed.",
  );
  throw error;
} finally {
  await prisma.$disconnect();
}
