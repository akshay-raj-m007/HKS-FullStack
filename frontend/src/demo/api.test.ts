import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { createDemoApi } from "./api";
import type { Address, Booking, Provider, Payment } from "../types";

describe("public interactive demo", () => {
  let demo: ReturnType<typeof createDemoApi>;
  beforeEach(() => {
    demo = createDemoApi();
  });
  afterEach(() => vi.useRealTimers());
  const post = (data: unknown, key?: string): RequestInit => ({
    method: "POST",
    body: JSON.stringify(data),
    headers: key ? { "Idempotency-Key": key } : {},
  });
  async function pickup() {
    const providers = (await demo("/providers")) as Provider[];
    const addresses = (await demo("/addresses")) as Address[];
    const provider = providers[0];
    return {
      providerId: provider.id,
      slotId: provider.slots[0].id,
      addressId: addresses[0].id,
      wasteTypes: [provider.wasteTypes[0].wasteType],
    };
  }
  it("reserves once, rejects a second claim, and simulates successful payment", async () => {
    const input = await pickup();
    const booking = (await demo(
      "/bookings/hold",
      post(input, "first"),
    )) as Booking;
    expect(
      ((await demo("/bookings/hold", post(input, "first"))) as Booking).id,
    ).toBe(booking.id);
    await expect(
      demo("/bookings/hold", post(input, "second")),
    ).rejects.toMatchObject({ code: "SLOT_NOT_AVAILABLE" });
    const payment = (await demo(
      "/payments/create",
      post({ bookingId: booking.id }),
    )) as Payment;
    expect(payment.amount).toBe(booking.amount);
    const paid = (await demo(
      "/payments/mock",
      post({ bookingId: booking.id, outcome: "success" }),
    )) as Booking;
    expect(paid.status).toBe("PROCESSING");
    expect(paid.payment?.status).toBe("PAID");
    const provider = (await demo("/providers/" + input.providerId)) as Provider;
    expect(provider.slots.some((slot) => slot.id === input.slotId)).toBe(false);
  });
  it("expires unpaid holds and makes their slots available again", async () => {
    vi.useFakeTimers();
    const input = await pickup();
    const booking = (await demo("/bookings/hold", post(input))) as Booking;
    vi.advanceTimersByTime(11 * 60000);
    expect(((await demo("/orders/" + booking.id)) as Booking).status).toBe(
      "EXPIRED",
    );
    const provider = (await demo("/providers/" + input.providerId)) as Provider;
    expect(provider.slots.some((slot) => slot.id === input.slotId)).toBe(true);
    await expect(
      demo("/payments/create", post({ bookingId: booking.id })),
    ).rejects.toMatchObject({ code: "HOLD_EXPIRED" });
  });
  it("preserves address snapshots and isolates data between page sessions", async () => {
    const input = await pickup();
    const booking = (await demo("/bookings/hold", post(input))) as Booking;
    const address = ((await demo("/addresses")) as Address[])[0];
    await demo("/addresses/" + address.id, {
      method: "PATCH",
      body: JSON.stringify({ ...address, contactName: "Priya Nair" }),
    });
    expect(
      ((await demo("/orders/" + booking.id)) as Booking).addressSnapshot
        .contactName,
    ).toBe("Ananya Sharma");
    const anotherTab = createDemoApi();
    await expect(anotherTab("/orders/" + booking.id)).rejects.toMatchObject({
      status: 404,
    });
  });
  it("releases failed payments and supports leaving and reopening the demo", async () => {
    const input = await pickup();
    const booking = (await demo("/bookings/hold", post(input))) as Booking;
    await demo("/payments/create", post({ bookingId: booking.id }));
    const failed = (await demo(
      "/payments/mock",
      post({ bookingId: booking.id, outcome: "failure" }),
    )) as Booking;
    expect(failed.status).toBe("PAYMENT_FAILED");
    expect(
      ((await demo("/providers/" + input.providerId)) as Provider).slots.some(
        (slot) => slot.id === input.slotId,
      ),
    ).toBe(true);
    await demo("/auth/logout", post({}));
    await expect(demo("/auth/refresh", post({}))).rejects.toMatchObject({
      status: 401,
    });
    expect(await demo("/auth/demo", post({}))).toHaveProperty("user");
  });
});
