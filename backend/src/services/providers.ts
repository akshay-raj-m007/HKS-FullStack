import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db, transaction } from "../repositories/db.js";
import { filterSchema, dateRange } from "../validators/schemas.js";
import { expireHolds } from "../jobs/expiry.js";
import { assert, notFound } from "../utils/errors.js";
import { MemoryCache } from "./cache.js";
const include = {
  wasteTypes: true,
  serviceAreas: true,
} satisfies Prisma.ServiceProviderInclude;
type Provider = Prisma.ServiceProviderGetPayload<{ include: typeof include }>;
const metadataCache = new MemoryCache<Provider[]>();
const servesLocation = (
  area: { city: string; postalCode: string },
  location: string,
) =>
  area.city.toLowerCase().includes(location.toLowerCase()) ||
  area.postalCode.includes(location);

export const acceptsMaterials = (
  supported: { wasteType: string }[],
  selected: string[],
) => selected.every((w) => supported.some((p) => p.wasteType === w));
export const coversAddress = (
  areas: { city: string; postalCode: string }[],
  address: { city: string; postalCode: string },
) =>
  areas.some(
    (area) =>
      area.postalCode === address.postalCode &&
      area.city.toLowerCase() === address.city.toLowerCase(),
  );

export async function providerList(
  filters: z.infer<typeof filterSchema>,
  cleanup = true,
  useCache = true,
) {
  if (cleanup) await expireHolds();
  let metadata = useCache ? metadataCache.get("all") : undefined;
  if (!metadata) {
    metadata = await db.serviceProvider.findMany({
      where: { active: true },
      include,
      orderBy: { name: "asc" },
    });
    if (useCache) metadataCache.set("all", metadata, 30000);
  }
  const matched = metadata.filter(
    (p) =>
      (!filters.wasteType ||
        p.wasteTypes.some((w) => w.wasteType === filters.wasteType)) &&
      (!filters.location ||
        p.serviceAreas.some((a) => servesLocation(a, filters.location!))),
  );
  return Promise.all(
    matched.map(async (p) => ({
      ...p,
      slots: await availability(p.id, filters, false),
    })),
  ).then((items) =>
    items.filter((p) => !(filters.date || filters.slot) || p.slots.length > 0),
  );
}
export async function providerDetail(id: string) {
  const provider = await db.serviceProvider.findFirst({
    where: { id, active: true },
    include,
  });
  if (!provider) throw notFound();
  return { ...provider, slots: await availability(id, {}) };
}
export async function availability(
  providerId: string,
  filters: z.infer<typeof filterSchema>,
  cleanup = true,
) {
  if (cleanup) await expireHolds();
  if (filters.location) {
    const areas = await db.providerServiceArea.findMany({
      where: { providerId },
      select: { city: true, postalCode: true },
    });
    if (!areas.some((area) => servesLocation(area, filters.location!)))
      return [];
  }
  const slots = await db.providerAvailabilitySlot.findMany({
    where: {
      providerId,
      provider: { active: true },
      status: "AVAILABLE",
      startAt: filters.date
        ? { ...dateRange(filters.date), gt: new Date() }
        : { gt: new Date() },
    },
    orderBy: { startAt: "asc" },
    take: 100,
    select: {
      id: true,
      providerId: true,
      startAt: true,
      endAt: true,
      status: true,
    },
  });
  return slots.filter(
    (s) =>
      !filters.slot ||
      (filters.slot === "morning"
        ? new Date(s.startAt.getTime() + 19800000).getUTCHours() < 12
        : new Date(s.startAt.getTime() + 19800000).getUTCHours() >= 12),
  );
}
export async function createAvailability(
  providerId: string,
  startAt: Date,
  endAt: Date,
) {
  assert(
    startAt > new Date() && endAt > startAt,
    400,
    "INVALID_SLOT",
    "Slots must be in the future and have a positive duration.",
  );
  return transaction(async (tx) => {
    const overlap = await tx.providerAvailabilitySlot.findFirst({
      where: { providerId, startAt: { lt: endAt }, endAt: { gt: startAt } },
    });
    assert(
      !overlap,
      409,
      "OVERLAPPING_SLOT",
      "This provider already has an overlapping time slot.",
    );
    return tx.providerAvailabilitySlot.create({
      data: { providerId, startAt, endAt },
    });
  });
}

/** Internal provider administration; never exposed as a public customer route. */
export async function updateAvailability(
  providerId: string,
  slotId: string,
  startAt: Date,
  endAt: Date,
) {
  assert(
    startAt > new Date() && endAt > startAt,
    400,
    "INVALID_SLOT",
    "Slots must be in the future and have a positive duration.",
  );
  return transaction(async (tx) => {
    const current = await tx.providerAvailabilitySlot.findFirst({
      where: { id: slotId, providerId },
    });
    if (!current) throw notFound();
    assert(
      current.status === "AVAILABLE",
      409,
      "SLOT_IN_USE",
      "A reserved slot cannot be rescheduled.",
    );
    const overlap = await tx.providerAvailabilitySlot.findFirst({
      where: {
        providerId,
        id: { not: slotId },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
    });
    assert(
      !overlap,
      409,
      "OVERLAPPING_SLOT",
      "This provider already has an overlapping time slot.",
    );
    return tx.providerAvailabilitySlot.update({
      where: { id: slotId },
      data: { startAt, endAt },
    });
  });
}
