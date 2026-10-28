import { ApiError } from "../api/error";
import type { Session } from "../api/client";
import { addressSchema, bookingSchema } from "../schemas/forms";
import type {
  Address,
  Booking,
  Payment,
  Provider,
  Slot,
  WasteType,
} from "../types";

// A deliberately isolated presentation model. It never calls the backend,
// stores credentials, sends OTPs, or represents a verified payment/session.
export function createDemoApi() {
  const hour = 3600000;
  const day = 24 * hour;
  const fixtureId = (group: number, index: number) =>
    `${group}0000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  const user = { id: fixtureId(0, 1), phone: "+919876543210" };
  let signedIn = true;
  const session: Session = { user, accessToken: "public-demo-session" };
  const addresses: Address[] = [
    {
      id: fixtureId(1, 1),
      label: "Home",
      contactName: "Ananya Sharma",
      contactPhone: user.phone,
      addressLine1: "14, 3rd Cross, Indiranagar",
      addressLine2: "Near 100 Feet Road",
      city: "Bengaluru",
      state: "Karnataka",
      postalCode: "560038",
    },
    {
      id: fixtureId(1, 2),
      label: "Work",
      contactName: "Rohan Mehta",
      contactPhone: user.phone,
      addressLine1: "28, MG Road",
      addressLine2: "Second floor",
      city: "Bengaluru",
      state: "Karnataka",
      postalCode: "560001",
    },
  ];
  const catalog: {
    name: string;
    description: string;
    price: number;
    color: string;
    wasteTypes: WasteType[];
  }[] = [
    {
      name: "GreenCycle Services",
      description: "Carefully sorted recycling, collected from your doorstep.",
      price: 14900,
      color: "sage",
      wasteTypes: ["PLASTIC", "PAPER", "GREEN_WASTE"],
    },
    {
      name: "EcoFood Collect",
      description:
        "Turning kitchen scraps and garden waste into healthier soil.",
      price: 9900,
      color: "peach",
      wasteTypes: ["FOOD", "GREEN_WASTE"],
    },
    {
      name: "Urban Recycling",
      description:
        "Responsible collection for electronics and mixed recyclables.",
      price: 24900,
      color: "lavender",
      wasteTypes: ["PLASTIC", "ELECTRONIC", "GENERAL"],
    },
    {
      name: "Everyday Earth",
      description:
        "One friendly collection for everything your home is ready to let go of.",
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
    },
    {
      name: "Paper Trail",
      description: "A new chapter for newspapers, cardboard and packaging.",
      price: 7900,
      color: "sky",
      wasteTypes: ["PAPER"],
    },
  ];
  const today = new Date(Date.now() + 5.5 * hour).toISOString().slice(0, 10);
  const midnight = new Date(today + "T00:00:00+05:30").getTime();
  const slots: Slot[] = [];
  const providers: Provider[] = catalog.map((entry, index) => {
    const id = fixtureId(2, index + 1);
    for (let offset = 1; offset <= 7; offset++) {
      for (const pickupHour of [9, 13, 16]) {
        const start = midnight + offset * day + pickupHour * hour;
        slots.push({
          id: fixtureId(3, slots.length + 1),
          providerId: id,
          startAt: new Date(start).toISOString(),
          endAt: new Date(start + hour).toISOString(),
          status: "AVAILABLE",
        });
      }
    }
    return {
      ...entry,
      id,
      currency: "INR",
      rating: 4.8,
      wasteTypes: entry.wasteTypes.map((wasteType) => ({ wasteType })),
      serviceAreas: ["560001", "560034", "560038"].map((postalCode) => ({
        city: "Bengaluru",
        postalCode,
      })),
      slots: [],
    };
  });
  const bookings: Booking[] = [];
  const idempotency = new Map<
    string,
    { fingerprint: string; bookingId: string }
  >();
  const pending = (booking: Booking) =>
    ["PENDING_PAYMENT", "PAYMENT_PROCESSING"].includes(booking.status);
  const fail = (status: number, code: string, message: string): never => {
    throw new ApiError(status, code, message);
  };
  function release(booking: Booking) {
    const slot = slots.find((entry) => entry.id === booking.slotId);
    if (slot?.status === "HELD") slot.status = "AVAILABLE";
  }
  function expire() {
    for (const booking of bookings) {
      if (
        pending(booking) &&
        new Date(booking.holdExpiresAt).getTime() <= Date.now()
      ) {
        booking.status = "EXPIRED";
        release(booking);
      }
    }
  }
  function makeBooking(
    provider: Provider,
    address: Address,
    slot: Slot,
    wasteTypes: WasteType[],
  ): Booking {
    return {
      id: crypto.randomUUID(),
      providerId: provider.id,
      providerName: provider.name,
      slotId: slot.id,
      addressSnapshot: structuredClone(address),
      startAt: slot.startAt,
      endAt: slot.endAt,
      amount: provider.price,
      currency: provider.currency,
      status: "PENDING_PAYMENT",
      holdExpiresAt: new Date(Date.now() + 10 * 60000).toISOString(),
      wasteTypes: wasteTypes.map((wasteType) => ({ wasteType })),
      payment: null,
      createdAt: new Date().toISOString(),
    };
  }
  function makePayment(booking: Booking): Payment {
    return {
      id: crypto.randomUUID(),
      provider: "mock",
      providerOrderId: "order_demo_" + booking.id,
      status: "CREATED",
      amount: booking.amount,
      currency: booking.currency,
      keyId: "mock",
    };
  }
  const upcoming = makeBooking(providers[0], addresses[0], slots[0], ["PAPER"]);
  upcoming.id = fixtureId(4, 1);
  upcoming.status = "PROCESSING";
  upcoming.payment = { ...makePayment(upcoming), status: "PAID" };
  slots[0].status = "BOOKED";
  bookings.push(upcoming);
  const previous = makeBooking(
    providers[4],
    addresses[1],
    {
      id: crypto.randomUUID(),
      providerId: providers[4].id,
      status: "BOOKED",
      startAt: new Date(midnight - 6 * day + 9 * hour).toISOString(),
      endAt: new Date(midnight - 6 * day + 10 * hour).toISOString(),
    },
    ["PAPER"],
  );
  previous.status = "COMPLETED";
  previous.id = fixtureId(4, 2);
  previous.createdAt = new Date(midnight - 8 * day).toISOString();
  previous.payment = { ...makePayment(previous), status: "PAID" };
  bookings.push(previous);

  function view(provider: Provider, params = new URLSearchParams()): Provider {
    return {
      ...provider,
      slots: slots.filter((slot) => {
        if (
          slot.providerId !== provider.id ||
          slot.status !== "AVAILABLE" ||
          new Date(slot.startAt).getTime() <= Date.now() + 10 * 60000
        )
          return false;
        const local = new Date(new Date(slot.startAt).getTime() + 5.5 * hour);
        if (
          params.get("date") &&
          local.toISOString().slice(0, 10) !== params.get("date")
        )
          return false;
        if (params.get("slot") === "morning" && local.getUTCHours() >= 12)
          return false;
        if (params.get("slot") === "afternoon" && local.getUTCHours() < 12)
          return false;
        return true;
      }),
    };
  }

  function handle(path: string, options: RequestInit = {}): unknown {
    const url = new URL(path, "https://demo.invalid");
    const route = url.pathname;
    const method = options.method ?? "GET";
    const body =
      typeof options.body === "string" ? JSON.parse(options.body) : {};
    if (route === "/auth/demo" && method === "POST") {
      signedIn = true;
      return session;
    }
    if (route === "/auth/logout" && method === "POST") {
      signedIn = false;
      return undefined;
    }
    if (!signedIn)
      return fail(401, "DEMO_SIGNED_OUT", "Open the demo to continue.");
    if (route === "/auth/refresh" && method === "POST") return session;
    if (route === "/me" && method === "GET") return user;
    expire();
    if (route === "/addresses") {
      if (method === "GET") return addresses;
      if (method === "POST") {
        const parsed = addressSchema.safeParse(body);
        if (!parsed.success)
          return fail(
            400,
            "INVALID_ADDRESS",
            "Enter a complete, valid address.",
          );
        const address = { ...parsed.data, id: crypto.randomUUID() };
        addresses.push(address);
        return address;
      }
    }
    if (route.startsWith("/addresses/")) {
      const index = addresses.findIndex(
        (address) => address.id === route.split("/")[2],
      );
      if (index < 0) return fail(404, "NOT_FOUND", "Address was not found.");
      if (method === "PATCH") {
        const parsed = addressSchema.safeParse(body);
        if (!parsed.success)
          return fail(
            400,
            "INVALID_ADDRESS",
            "Enter a complete, valid address.",
          );
        addresses[index] = { ...parsed.data, id: addresses[index].id };
        return addresses[index];
      }
      if (method === "DELETE") {
        if (
          bookings.some(
            (booking) => booking.addressSnapshot.id === addresses[index].id,
          )
        )
          return fail(
            409,
            "ADDRESS_IN_USE",
            "This address is part of a pickup and cannot be removed.",
          );
        addresses.splice(index, 1);
        return undefined;
      }
    }
    if (route === "/providers" && method === "GET") {
      return providers
        .filter((provider) => {
          const waste = url.searchParams.get("wasteType");
          const location = url.searchParams.get("location")?.toLowerCase();
          return (
            (!waste ||
              provider.wasteTypes.some((entry) => entry.wasteType === waste)) &&
            (!location ||
              provider.serviceAreas.some(
                (area) =>
                  area.city.toLowerCase() === location ||
                  area.postalCode === location,
              ))
          );
        })
        .map((provider) => view(provider, url.searchParams))
        .filter((provider) => provider.slots.length);
    }
    if (route.startsWith("/providers/") && method === "GET") {
      const provider = providers.find(
        (entry) => entry.id === route.split("/")[2],
      );
      if (!provider) return fail(404, "NOT_FOUND", "Provider was not found.");
      const result = view(provider, url.searchParams);
      return route.endsWith("/availability") ? result.slots : result;
    }
    if (route === "/bookings/hold" && method === "POST") {
      const parsed = bookingSchema.safeParse(body);
      if (!parsed.success)
        return fail(
          400,
          "INVALID_BOOKING",
          "Choose an address, waste type and available slot.",
        );
      const key = new Headers(options.headers).get("Idempotency-Key");
      const fingerprint = JSON.stringify({
        ...parsed.data,
        providerId: body.providerId,
      });
      if (key && idempotency.has(key)) {
        const previous = idempotency.get(key)!;
        if (previous.fingerprint !== fingerprint)
          return fail(
            409,
            "IDEMPOTENCY_CONFLICT",
            "This request key already belongs to a different pickup.",
          );
        return bookings.find((booking) => booking.id === previous.bookingId);
      }
      const provider = providers.find((entry) => entry.id === body.providerId);
      const address = addresses.find(
        (entry) => entry.id === parsed.data.addressId,
      );
      const slot = slots.find(
        (entry) =>
          entry.id === parsed.data.slotId && entry.providerId === provider?.id,
      );
      if (!provider || !address || !slot)
        return fail(404, "NOT_FOUND", "Pickup details were not found.");
      if (
        !parsed.data.wasteTypes.every((waste) =>
          provider.wasteTypes.some((entry) => entry.wasteType === waste),
        )
      )
        return fail(
          400,
          "UNSUPPORTED_WASTE",
          "This partner does not collect the selected waste.",
        );
      if (
        !provider.serviceAreas.some(
          (area) =>
            area.postalCode === address.postalCode &&
            area.city.toLowerCase() === address.city.toLowerCase(),
        )
      )
        return fail(
          400,
          "UNSUPPORTED_LOCATION",
          "This partner does not serve the address.",
        );
      if (
        slot.status !== "AVAILABLE" ||
        new Date(slot.startAt).getTime() <= Date.now() + 10 * 60000
      )
        return fail(
          409,
          "SLOT_NOT_AVAILABLE",
          "This slot is no longer available. Please choose another.",
        );
      const booking = makeBooking(
        provider,
        address,
        slot,
        parsed.data.wasteTypes,
      );
      slot.status = "HELD";
      bookings.unshift(booking);
      if (key) idempotency.set(key, { fingerprint, bookingId: booking.id });
      return booking;
    }
    if ((route === "/bookings" || route === "/orders") && method === "GET")
      return [...bookings].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      );
    if (route.startsWith("/bookings/") || route.startsWith("/orders/")) {
      const booking = bookings.find(
        (entry) => entry.id === route.split("/")[2],
      );
      if (!booking) return fail(404, "NOT_FOUND", "Pickup was not found.");
      if (method === "GET") return booking;
      if (route.endsWith("/cancel") && method === "POST") {
        if (booking.status === "CANCELLED") return booking;
        if (!pending(booking))
          return fail(
            409,
            "INVALID_STATE",
            "Only unpaid reservations can be cancelled.",
          );
        booking.status = "CANCELLED";
        release(booking);
        return booking;
      }
    }
    if (
      (route === "/payments/create" || route === "/payments/mock") &&
      method === "POST"
    ) {
      const booking = bookings.find((entry) => entry.id === body.bookingId);
      if (!booking) return fail(404, "NOT_FOUND", "Pickup was not found.");
      if (route === "/payments/mock" && booking.payment?.status === "PAID")
        return booking;
      if (!pending(booking))
        return fail(
          409,
          "HOLD_EXPIRED",
          "This reservation is no longer payable.",
        );
      if (route === "/payments/create") {
        booking.payment ??= makePayment(booking);
        booking.status = "PAYMENT_PROCESSING";
        return booking.payment;
      }
      if (!booking.payment)
        return fail(
          409,
          "PAYMENT_NOT_CREATED",
          "Create a payment order first.",
        );
      if (!["success", "failure"].includes(body.outcome))
        return fail(
          400,
          "INVALID_OUTCOME",
          "Choose a simulated payment outcome.",
        );
      if (body.outcome === "success") {
        booking.payment.status = "PAID";
        booking.status = "PROCESSING";
        slots.find((slot) => slot.id === booking.slotId)!.status = "BOOKED";
      } else {
        booking.payment.status = "FAILED";
        booking.status = "PAYMENT_FAILED";
        release(booking);
      }
      return booking;
    }
    return fail(
      404,
      "DEMO_ROUTE_UNAVAILABLE",
      "This action is unavailable in the interactive demo.",
    );
  }
  return async (path: string, options: RequestInit = {}): Promise<unknown> =>
    structuredClone(handle(path, options));
}

export const demoRequest = createDemoApi();
