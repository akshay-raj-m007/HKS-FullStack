import { PrismaClient, WasteType } from "@prisma/client";
export async function seedDatabase(db: PrismaClient) {
  const providers: {
    name: string;
    description: string;
    price: number;
    color: string;
    wasteTypes: WasteType[];
    areas: { city: string; postalCode: string }[];
  }[] = [
    {
      name: "GreenCycle Services",
      description:
        "Give everyday recyclables a fresh start. Carefully sorted collection from your doorstep.",
      price: 14900,
      color: "sage",
      wasteTypes: ["PLASTIC", "PAPER", "GREEN_WASTE"],
      areas: [
        { city: "Bengaluru", postalCode: "560001" },
        { city: "Bengaluru", postalCode: "560038" },
        { city: "Bengaluru", postalCode: "560034" },
      ],
    },
    {
      name: "EcoFood Collect",
      description:
        "From kitchen scraps to healthier soil. A little daily care for a greener neighbourhood.",
      price: 9900,
      color: "peach",
      wasteTypes: ["FOOD", "GREEN_WASTE"],
      areas: [
        { city: "Bengaluru", postalCode: "560001" },
        { city: "Bengaluru", postalCode: "560034" },
      ],
    },
    {
      name: "Urban Recycling",
      description:
        "Responsible collection for electronics and mixed recyclables, handled with extra care.",
      price: 24900,
      color: "lavender",
      wasteTypes: ["PLASTIC", "ELECTRONIC", "GENERAL"],
      areas: [
        { city: "Bengaluru", postalCode: "560038" },
        { city: "Bengaluru", postalCode: "560001" },
        { city: "Mysuru", postalCode: "570001" },
      ],
    },
    {
      name: "Everyday Earth",
      description:
        "One friendly pickup for everything your home is ready to let go of.",
      price: 19900,
      color: "sand",
      wasteTypes: [
        "PLASTIC",
        "FOOD",
        "GREEN_WASTE",
        "PAPER",
        "ELECTRONIC",
        "GENERAL",
      ],
      areas: [
        { city: "Bengaluru", postalCode: "560001" },
        { city: "Bengaluru", postalCode: "560034" },
        { city: "Mysuru", postalCode: "570001" },
      ],
    },
    {
      name: "Paper Trail",
      description:
        "A new chapter for your old newspapers, cardboard and packaging.",
      price: 7900,
      color: "sky",
      wasteTypes: ["PAPER"],
      areas: [
        { city: "Bengaluru", postalCode: "560038" },
        { city: "Bengaluru", postalCode: "560001" },
      ],
    },
  ];
  return db.$transaction(
    async (tx) => {
      for (const [index, p] of providers.entries()) {
        const { wasteTypes, areas, ...data } = p;
        const provider = await tx.serviceProvider.upsert({
          where: { name: p.name },
          update: data,
          create: data,
        });
        for (const wasteType of wasteTypes)
          await tx.providerWasteType.upsert({
            where: {
              providerId_wasteType: { providerId: provider.id, wasteType },
            },
            update: {},
            create: { providerId: provider.id, wasteType },
          });
        for (const area of areas)
          await tx.providerServiceArea.upsert({
            where: {
              providerId_postalCode: {
                providerId: provider.id,
                postalCode: area.postalCode,
              },
            },
            update: area,
            create: { providerId: provider.id, ...area },
          });
        const localDate = new Date(Date.now() + 19800000)
          .toISOString()
          .slice(0, 10);
        for (let day = 1; day <= 7; day++)
          for (const hour of [9 + (index % 2), 13, 16]) {
            const startAt = new Date(
              new Date(localDate + "T00:00:00+05:30").getTime() +
                day * 86400000 +
                hour * 3600000,
            );
            const endAt = new Date(startAt.getTime() + 3600000);
            await tx.providerAvailabilitySlot.upsert({
              where: {
                providerId_startAt_endAt: {
                  providerId: provider.id,
                  startAt,
                  endAt,
                },
              },
              update: {},
              create: { providerId: provider.id, startAt, endAt },
            });
          }
      }
      return providers.length;
    },
    { timeout: 120000 },
  );
}
