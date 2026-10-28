import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import { db, transaction } from "../src/repositories/db.js";
import { env } from "../src/config/env.js";
import { indianDay } from "../src/assistant/time.js";

// Creates only isolated guest fixtures; it never truncates shared database tables.
const userIds: string[] = [];
const server = createApp({
  assistantModel: {
    plan: async () => ({
      intent: "search",
      materials: ["PAPER"],
      unsupportedItems: [],
      addressLabel: "Home",
      location: null,
      date: { kind: "unknown", value: null },
      after: null,
      before: null,
      sort: "cheapest",
      missing: null,
      screen: null,
    }),
    observe: async () => {
      throw new Error("Postgres verifier never calls a vision model");
    },
  },
}).listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
assert(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}/api`;
type Session = { user: { id: string }; accessToken: string };
async function request(
  path: string,
  session?: Session,
  body?: unknown,
  cookie?: string,
) {
  const response = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "Loop",
      "Idempotency-Key": randomUUID(),
      ...(session ? { Authorization: "Bearer " + session.accessToken } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    payload: await response.json(),
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}
try {
  assert.equal((await request("/health")).status, 200);
  const guests = await Promise.all([
    request("/auth/demo", undefined, {}),
    request("/auth/demo", undefined, {}),
  ]);
  for (const guest of guests) {
    assert.equal(guest.status, 200);
    userIds.push(guest.payload.data.user.id);
  }
  const sessions: Session[] = guests.map((guest) => guest.payload.data);
  assert.notEqual(sessions[0].user.id, sessions[1].user.id);
  console.log(
    "PASS: server started, Neon health query, separate JWT guest identities",
  );
  const addressLists = await Promise.all(
    sessions.map((session) => request("/addresses", session)),
  );
  const providersResponse = await request("/providers", sessions[0]);
  const provider = providersResponse.payload.data.find(
    (entry: { name: string }) => entry.name === "GreenCycle Services",
  );
  assert(provider?.slots.length, "Seed providers/slots before verification.");
  const slot = provider.slots[0];
  const originalAI = {
    AI_ASSISTANT_ENABLED: env.AI_ASSISTANT_ENABLED,
    NVIDIA_API_KEY: env.NVIDIA_API_KEY,
    NVIDIA_CHAT_MODEL: env.NVIDIA_CHAT_MODEL,
  };
  try {
    Object.assign(env, {
      AI_ASSISTANT_ENABLED: true,
      NVIDIA_API_KEY: "mock-transport-only",
      NVIDIA_CHAT_MODEL: "mock-intent",
    });
    const ai = await request("/assistant/search", sessions[0], {
      message: "Paper at Home",
      date: indianDay(new Date(slot.startAt)),
      addressId: addressLists[0].payload.data[0].id,
    });
    assert.equal(ai.status, 200);
    assert.equal(ai.payload.data.outcome, "results");
    assert.equal(ai.payload.data.addressId, addressLists[0].payload.data[0].id);
    assert(
      ai.payload.data.providers.every((card: { slots: { status: string }[] }) =>
        card.slots.every((entry) => entry.status === "AVAILABLE"),
      ),
    );
    assert.equal(
      (
        await request("/assistant/search", sessions[1], {
          message: "Paper",
          addressId: addressLists[0].payload.data[0].id,
        })
      ).status,
      404,
    );
    console.log(
      "PASS: real MCP → Postgres providers/live slots, mock intent, foreign-address isolation; no NVIDIA requests",
    );
  } finally {
    Object.assign(env, originalAI);
  }
  const attempts = await Promise.all(
    sessions.map((session, index) =>
      request("/bookings/hold", session, {
        providerId: provider.id,
        slotId: slot.id,
        addressId: addressLists[index].payload.data[0].id,
        wasteTypes: ["PAPER"],
      }),
    ),
  );
  assert.deepEqual(
    attempts.map((attempt) => attempt.status).sort(),
    [201, 409],
  );
  const winner = attempts.findIndex((attempt) => attempt.status === 201);
  const loser = 1 - winner;
  const booking = attempts[winner].payload.data;
  assert.equal(
    (await request("/bookings/" + booking.id, sessions[loser])).status,
    404,
  );
  console.log(
    "PASS: concurrent reservations yield one winner; other guest cannot access booking",
  );
  const payment = await request("/payments/create", sessions[winner], {
    bookingId: booking.id,
  });
  assert.equal(payment.status, 200);
  assert.equal(payment.payload.data.amount, booking.amount);
  assert.equal(
    (await request("/payments/" + payment.payload.data.id, sessions[loser]))
      .status,
    404,
  );
  const result = await request("/payments/mock", sessions[winner], {
    bookingId: booking.id,
    outcome: "success",
  });
  assert.equal(result.status, 200);
  assert.equal(result.payload.data.status, "PROCESSING");
  assert.equal(result.payload.data.payment.status, "PAID");
  const persisted = await db.booking.findUniqueOrThrow({
    where: { id: booking.id },
    include: { payment: true },
  });
  assert.equal(persisted.payment?.status, "PAID");
  assert.equal(
    (
      await db.providerAvailabilitySlot.findUniqueOrThrow({
        where: { id: slot.id },
      })
    ).status,
    "BOOKED",
  );
  console.log(
    "PASS: mock signature verification and paid booking persisted in Neon",
  );
  const refreshed = await request(
    "/auth/refresh",
    undefined,
    {},
    guests[winner].cookie,
  );
  assert.equal(refreshed.status, 200);
  assert.notEqual(refreshed.cookie, guests[winner].cookie);
  assert.equal(
    (await request("/auth/refresh", undefined, {}, guests[winner].cookie))
      .status,
    401,
  );
  console.log("PASS: refresh rotation and replay rejection");
  await assert.rejects(
    db.providerAvailabilitySlot.create({
      data: {
        providerId: provider.id,
        startAt: new Date(new Date(slot.startAt).getTime() + 300000),
        endAt: new Date(new Date(slot.endAt).getTime() + 300000),
      },
    }),
  );
  assert.equal(
    await db.providerAvailabilitySlot.count({
      where: {
        providerId: provider.id,
        startAt: new Date(new Date(slot.startAt).getTime() + 300000),
      },
    }),
    0,
  );
  console.log("PASS: database rejects partially overlapping provider slots");
} finally {
  if (userIds.length)
    await transaction(async (tx) => {
      const bookings = await tx.booking.findMany({
        where: { userId: { in: userIds } },
        select: { id: true },
      });
      await tx.providerAvailabilitySlot.updateMany({
        where: {
          activeBookingId: { in: bookings.map((booking) => booking.id) },
        },
        data: {
          status: "AVAILABLE",
          heldByUserId: null,
          holdExpiresAt: null,
          activeBookingId: null,
        },
      });
      await tx.payment.deleteMany({
        where: { bookingId: { in: bookings.map((booking) => booking.id) } },
      });
      await tx.booking.deleteMany({ where: { userId: { in: userIds } } });
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
    });
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await db.$disconnect();
  console.log("Verification guest fixtures cleaned up.");
}
