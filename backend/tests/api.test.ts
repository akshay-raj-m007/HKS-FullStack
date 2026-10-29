import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { createApp } from "../src/app.js";
import { db } from "../src/repositories/db.js";
import { seedDatabase } from "../prisma/seed-data.js";
import { MockPaymentProvider } from "../src/payments/mock.js";
import { env } from "../src/config/env.js";
import { hmac } from "../src/utils/crypto.js";
import { expireHolds } from "../src/jobs/expiry.js";
import {
  createAvailability,
  updateAvailability,
  availability,
} from "../src/services/providers.js";
import { RazorpayPaymentProvider } from "../src/payments/razorpay.js";
const codes = new Map<string, string>();
let gateway: MockPaymentProvider;
let app: ReturnType<typeof createApp>;
const addressData = {
  label: "Home",
  contactName: "Test resident",
  contactPhone: "+919876543210",
  addressLine1: "12 Garden Road",
  addressLine2: "Second floor",
  city: "Bengaluru",
  state: "Karnataka",
  postalCode: "560001",
};
async function login(phone = "+919876543210") {
  const otp = await request(app).post("/api/auth/request-otp").send({ phone });
  expect(otp.status).toBe(200);
  const response = await request(app)
    .post("/api/auth/verify-otp")
    .send({
      phone,
      challengeId: otp.body.data.challengeId,
      code: codes.get(phone),
    });
  expect(response.status).toBe(200);
  return {
    token: response.body.data.accessToken as string,
    userId: response.body.data.user.id as string,
    cookie: response.headers["set-cookie"][0].split(";")[0] as string,
    phone,
  };
}
type Session = Awaited<ReturnType<typeof login>>;
async function address(session: Session, data = addressData) {
  const response = await request(app)
    .post("/api/addresses")
    .auth(session.token, { type: "bearer" })
    .send(data);
  expect(response.status).toBe(201);
  return response.body.data;
}
async function fixture() {
  const a = await login(),
    b = await login("+919876543211");
  const aa = await address(a),
    ab = await address(b);
  const provider = await db.serviceProvider.findUniqueOrThrow({
    where: { name: "GreenCycle Services" },
    include: {
      slots: {
        where: {
          startAt: { gt: new Date(Date.now() + env.HOLD_MINUTES * 60000) },
        },
        orderBy: { startAt: "asc" },
      },
    },
  });
  return {
    a,
    b,
    aa,
    ab,
    provider,
    input: {
      providerId: provider.id,
      slotId: provider.slots[0].id,
      addressId: aa.id,
      wasteTypes: ["PLASTIC"],
    },
  };
}
const hold = (s: Session, input: object, key = randomUUID()) =>
  request(app)
    .post("/api/bookings/hold")
    .auth(s.token, { type: "bearer" })
    .set("Idempotency-Key", key)
    .send(input);
const createPayment = (s: Session, bookingId: string) =>
  request(app)
    .post("/api/payments/create")
    .auth(s.token, { type: "bearer" })
    .send({ bookingId });
const mockPayment = (s: Session, bookingId: string, outcome = "success") =>
  request(app)
    .post("/api/payments/mock")
    .auth(s.token, { type: "bearer" })
    .send({ bookingId, outcome });
beforeAll(async () => {
  if (!process.env.DATABASE_URL?.endsWith("test.db"))
    throw new Error("Tests must use the dedicated test database.");
  await db.$connect();
  await seedDatabase(db);
});
beforeEach(async () => {
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
  codes.clear();
  gateway = new MockPaymentProvider();
  app = createApp({
    gateway,
    otp: {
      async send(phone, code) {
        codes.set(phone, code);
      },
    },
  });
});
afterAll(() => db.$disconnect());

describe("OTP authentication and sessions", () => {
  it("keeps hosted demo guests isolated behind signed JWTs", async () => {
    const previous = env.PUBLIC_DEMO_MODE;
    env.PUBLIC_DEMO_MODE = true;
    try {
      const a = await request(app).post("/api/auth/demo").send({});
      const b = await request(app).post("/api/auth/demo").send({});
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect(a.body.data.user.id).not.toBe(b.body.data.user.id);
      const claims = jwt.verify(a.body.data.accessToken, env.JWT_ACCESS_SECRET);
      expect(claims).toMatchObject({ sub: a.body.data.user.id });
      const own = await request(app)
        .get("/api/addresses")
        .auth(a.body.data.accessToken, { type: "bearer" });
      const other = await request(app)
        .get("/api/addresses")
        .auth(b.body.data.accessToken, { type: "bearer" });
      expect(own.body.data[0].id).not.toBe(other.body.data[0].id);
      const denied = await request(app)
        .delete("/api/addresses/" + own.body.data[0].id)
        .auth(b.body.data.accessToken, { type: "bearer" })
        .send({});
      expect(denied.status).toBe(404);
      expect(
        (
          await request(app)
            .post("/api/auth/request-otp")
            .send({ phone: "+919876543210" })
        ).status,
      ).toBe(403);
      expect((await request(app).get("/api/me")).status).toBe(401);
    } finally {
      env.PUBLIC_DEMO_MODE = previous;
    }
    expect((await request(app).post("/api/auth/demo").send({})).status).toBe(
      404,
    );
  });
  it("accepts mobile numbers but rejects landlines for OTP delivery", async () => {
    const valid = await request(app)
      .post("/api/auth/request-otp")
      .send({ phone: "98765 43210" });
    expect(valid.status).toBe(200);
    expect(codes.has("+919876543210")).toBe(true);

    for (const phone of ["08023456789", "+911123456789"]) {
      const rejected = await request(app)
        .post("/api/auth/request-otp")
        .send({ phone });
      expect(rejected.status).toBe(400);
      expect(rejected.body.error.code).toBe("VALIDATION_ERROR");
    }
  });
  it("generates a random hashed OTP, authenticates once, and sets a private cookie", async () => {
    const phone = "+919876543210";
    const sent = await request(app)
      .post("/api/auth/request-otp")
      .send({ phone: "98765 43210" });
    expect(sent.status).toBe(200);
    expect(sent.body.data).not.toHaveProperty("code");
    const challenge = await db.otpChallenge.findUniqueOrThrow({
      where: { id: sent.body.data.challengeId },
    });
    expect(challenge.phone).toBe(phone);
    expect(challenge.codeHash).toHaveLength(64);
    expect(challenge.codeHash).not.toBe(codes.get(phone));
    const body = { phone, challengeId: challenge.id, code: codes.get(phone) };
    const verified = await request(app).post("/api/auth/verify-otp").send(body);
    expect(verified.status).toBe(200);
    expect(verified.headers["set-cookie"][0]).toContain("HttpOnly");
    expect(verified.headers["set-cookie"][0]).toContain("SameSite=Strict");
    expect(
      (await request(app).post("/api/auth/verify-otp").send(body)).status,
    ).toBe(401);
  });
  it("rejects invalid OTP and locks out after five failed attempts", async () => {
    const phone = "+919876543210";
    const sent = await request(app)
      .post("/api/auth/request-otp")
      .send({ phone });
    const bad = codes.get(phone) === "111111" ? "222222" : "111111";
    for (let i = 0; i < 5; i++)
      expect(
        (
          await request(app)
            .post("/api/auth/verify-otp")
            .send({ phone, challengeId: sent.body.data.challengeId, code: bad })
        ).status,
      ).toBe(401);
    expect(
      (
        await request(app)
          .post("/api/auth/verify-otp")
          .send({
            phone,
            challengeId: sent.body.data.challengeId,
            code: codes.get(phone),
          })
      ).status,
    ).toBe(401);
    expect(
      (
        await db.otpChallenge.findUniqueOrThrow({
          where: { id: sent.body.data.challengeId },
        })
      ).attempts,
    ).toBe(5);
  });
  it("rejects expired OTPs", async () => {
    const phone = "+919876543210";
    const sent = await request(app)
      .post("/api/auth/request-otp")
      .send({ phone });
    await db.otpChallenge.update({
      where: { id: sent.body.data.challengeId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(
      (
        await request(app)
          .post("/api/auth/verify-otp")
          .send({
            phone,
            challengeId: sent.body.data.challengeId,
            code: codes.get(phone),
          })
      ).status,
    ).toBe(401);
  });
  it("limits resends per phone and requests per IP", async () => {
    const phone = "+919876543210";
    await request(app).post("/api/auth/request-otp").send({ phone });
    expect(
      (await request(app).post("/api/auth/request-otp").send({ phone })).body
        .error.code,
    ).toBe("OTP_RESEND_LIMIT");
    let last;
    for (let i = 0; i < 10; i++)
      last = await request(app).post("/api/auth/request-otp").send({ phone });
    expect(last?.status).toBe(429);
    expect(last?.headers["retry-after"]).toBeDefined();
  });
  it("limits OTP verification requests", async () => {
    let last;
    for (let i = 0; i < 31; i++)
      last = await request(app).post("/api/auth/verify-otp").send({
        phone: "+919876543210",
        challengeId: randomUUID(),
        code: "000000",
      });
    expect(last?.status).toBe(429);
  });
  it("rotates refresh tokens and revokes the family on replay", async () => {
    const s = await login();
    const rotated = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", s.cookie)
      .set("X-Requested-With", "Loop")
      .send({});
    expect(rotated.status).toBe(200);
    const next = rotated.headers["set-cookie"][0].split(";")[0];
    expect(next).not.toBe(s.cookie);
    expect(
      (
        await request(app)
          .post("/api/auth/refresh")
          .set("Cookie", s.cookie)
          .set("X-Requested-With", "Loop")
          .send({})
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post("/api/auth/refresh")
          .set("Cookie", next)
          .set("X-Requested-With", "Loop")
          .send({})
      ).status,
    ).toBe(401);
  });
  it("revokes refresh tokens on logout and protects cookie endpoints from CSRF", async () => {
    const s = await login();
    expect(
      (
        await request(app)
          .post("/api/auth/refresh")
          .set("Cookie", s.cookie)
          .send({})
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post("/api/auth/logout")
          .set("Cookie", s.cookie)
          .set("X-Requested-With", "Loop")
          .send({})
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post("/api/auth/refresh")
          .set("Cookie", s.cookie)
          .set("X-Requested-With", "Loop")
          .send({})
      ).status,
    ).toBe(401);
  });
  it("rejects malformed, forged, and expired access tokens", async () => {
    for (const token of [
      "not-a-jwt",
      jwt.sign({ sub: randomUUID() }, "wrong-secret"),
      jwt.sign({}, env.JWT_ACCESS_SECRET, {
        subject: randomUUID(),
        expiresIn: -1,
        issuer: "loop-api",
        audience: "loop-web",
      }),
    ]) {
      expect(
        (await request(app).get("/api/orders").auth(token, { type: "bearer" }))
          .status,
      ).toBe(401);
    }
  });
});

describe("authorization and validation", () => {
  it("requires a mobile number for an address contact", async () => {
    const s = await login();
    const rejected = await request(app)
      .post("/api/addresses")
      .auth(s.token, { type: "bearer" })
      .send({ ...addressData, contactPhone: "08023456789" });
    expect(rejected.status).toBe(400);
    expect(await db.userAddress.count()).toBe(0);
  });
  it("rejects unauthenticated access to all user resources", async () => {
    for (const path of [
      "/api/me",
      "/api/addresses",
      "/api/bookings",
      "/api/orders",
      "/api/providers",
      "/api/payments/" + randomUUID(),
    ])
      expect((await request(app).get(path)).status).toBe(401);
  });
  it("isolates addresses, bookings, orders, payments, and profile in both directions", async () => {
    const f = await fixture();
    const ah = await hold(f.a, f.input);
    const bh = await hold(f.b, {
      ...f.input,
      addressId: f.ab.id,
      slotId: f.provider.slots[1].id,
    });
    const ap = await createPayment(f.a, ah.body.data.id),
      bp = await createPayment(f.b, bh.body.data.id);
    for (const [s, otherAddress, otherBooking, otherPayment] of [
      [f.a, f.ab, bh.body.data, bp.body.data],
      [f.b, f.aa, ah.body.data, ap.body.data],
    ] as const) {
      for (const path of [
        "/api/addresses/" + otherAddress.id,
        "/api/bookings/" + otherBooking.id,
        "/api/orders/" + otherBooking.id,
        "/api/payments/" + otherPayment.id,
      ])
        expect(
          (await request(app).get(path).auth(s.token, { type: "bearer" }))
            .status,
        ).toBe(404);
      expect(
        (
          await request(app)
            .patch("/api/addresses/" + otherAddress.id)
            .auth(s.token, { type: "bearer" })
            .send(addressData)
        ).status,
      ).toBe(404);
      expect(
        (
          await request(app)
            .delete("/api/addresses/" + otherAddress.id)
            .auth(s.token, { type: "bearer" })
            .send({})
        ).status,
      ).toBe(404);
      expect((await createPayment(s, otherBooking.id)).status).toBe(404);
      expect((await mockPayment(s, otherBooking.id)).status).toBe(404);
      expect(
        (
          await request(app)
            .post("/api/bookings/" + otherBooking.id + "/cancel")
            .auth(s.token, { type: "bearer" })
            .send({})
        ).status,
      ).toBe(404);
      const me = await request(app)
        .get("/api/me")
        .auth(s.token, { type: "bearer" });
      expect(me.body.data.id).toBe(s.userId);
      const orders = await request(app)
        .get("/api/orders")
        .auth(s.token, { type: "bearer" });
      expect(orders.body.data).toHaveLength(1);
      expect(orders.body.data[0].userId).toBe(s.userId);
    }
    expect((await hold(f.a, { ...f.input, addressId: f.ab.id })).status).toBe(
      404,
    );
  });
  it("rejects invalid UUIDs, injected identity, price, HTML and SQL payloads", async () => {
    const f = await fixture();
    expect(
      (
        await request(app)
          .get("/api/orders/not-a-uuid")
          .auth(f.a.token, { type: "bearer" })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .get("/api/addresses/' OR 1=1 --")
          .auth(f.a.token, { type: "bearer" })
      ).status,
    ).toBe(400);
    expect(
      (await hold(f.a, { ...f.input, userId: f.b.userId, amount: 1 })).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post("/api/addresses")
          .auth(f.a.token, { type: "bearer" })
          .send({ ...addressData, label: "<script>alert(1)</script>" })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post("/api/auth/request-otp")
          .send({ phone: "' OR 1=1 --" })
      ).status,
    ).toBe(400);
    expect(await db.user.count()).toBe(2);
  });
  it("enforces origin, body size and safe error responses", async () => {
    expect(
      (
        await request(app)
          .post("/api/auth/request-otp")
          .set("Origin", "https://evil.example")
          .send({ phone: "+919876543210" })
      ).status,
    ).toBe(403);
    const large = await request(app)
      .post("/api/auth/request-otp")
      .send({ phone: "x".repeat(20000) });
    expect(large.status).toBe(413);
    expect(large.body.error).not.toHaveProperty("stack");
    const health = await request(app).get("/api/health");
    expect(health.headers["x-content-type-options"]).toBe("nosniff");
    expect(health.headers["content-security-policy"]).toBeDefined();
  });
  it("allows address updates, preserves historical snapshots, and only deletes unused addresses", async () => {
    const f = await fixture();
    const booked = await hold(f.a, f.input);
    expect(
      (
        await request(app)
          .patch("/api/addresses/" + f.aa.id)
          .auth(f.a.token, { type: "bearer" })
          .send({ ...addressData, addressLine1: "99 New Road" })
      ).status,
    ).toBe(200);
    const order = await request(app)
      .get("/api/orders/" + booked.body.data.id)
      .auth(f.a.token, { type: "bearer" });
    expect(order.body.data.addressSnapshot.addressLine1).toBe("12 Garden Road");
    expect(
      (
        await request(app)
          .delete("/api/addresses/" + f.aa.id)
          .auth(f.a.token, { type: "bearer" })
          .send({})
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .delete("/api/addresses/" + f.ab.id)
          .auth(f.b.token, { type: "bearer" })
          .send({})
      ).status,
    ).toBe(204);
  });
});

describe("booking invariants and concurrency", () => {
  it("holds atomically, calculates price on the server, and prevents duplicate bookings", async () => {
    const f = await fixture(),
      key = randomUUID();
    const first = await hold(f.a, f.input, key);
    expect(first.status).toBe(201);
    expect(first.body.data.amount).toBe(f.provider.price);
    expect(first.body.data.status).toBe("PENDING_PAYMENT");
    const repeat = await hold(f.a, f.input, key);
    expect(repeat.status).toBe(201);
    expect(repeat.body.data.id).toBe(first.body.data.id);
    expect(
      (await hold(f.a, { ...f.input, wasteTypes: ["PAPER"] }, key)).status,
    ).toBe(409);
    expect(
      (await hold(f.b, { ...f.input, addressId: f.ab.id })).body.error.code,
    ).toBe("SLOT_NOT_AVAILABLE");
    expect(await db.booking.count()).toBe(1);
  });
  it("permits exactly one of two simultaneous users to reserve the same slot", async () => {
    const f = await fixture();
    const results = await Promise.all([
      hold(f.a, f.input),
      hold(f.b, { ...f.input, addressId: f.ab.id }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await db.booking.count()).toBe(1);
    const slot = await db.providerAvailabilitySlot.findUniqueOrThrow({
      where: { id: f.input.slotId },
    });
    expect(slot.status).toBe("HELD");
    expect(slot.activeBookingId).toBeTruthy();
  });
  it("coalesces concurrent retries with the same idempotency key", async () => {
    const f = await fixture(),
      key = randomUUID();
    const results = await Promise.all([
      hold(f.a, f.input, key),
      hold(f.a, f.input, key),
    ]);
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(results[0].body.data.id).toBe(results[1].body.data.id);
    expect(await db.booking.count()).toBe(1);
  });
  it("rejects unsupported waste and locations without claiming a slot", async () => {
    const f = await fixture();
    expect(
      (await hold(f.a, { ...f.input, wasteTypes: ["ELECTRONIC"] })).body.error
        .code,
    ).toBe("UNSUPPORTED_WASTE");
    const elsewhere = await address(f.a, {
      ...addressData,
      postalCode: "110001",
      city: "Delhi",
    });
    expect(
      (await hold(f.a, { ...f.input, addressId: elsewhere.id })).body.error
        .code,
    ).toBe("UNSUPPORTED_LOCATION");
    expect(
      (
        await db.providerAvailabilitySlot.findUniqueOrThrow({
          where: { id: f.input.slotId },
        })
      ).status,
    ).toBe("AVAILABLE");
  });
  it("expires holds and lets a different user reserve the released slot", async () => {
    const f = await fixture(),
      first = await hold(f.a, f.input);
    const past = new Date(Date.now() - 1000);
    await db.booking.update({
      where: { id: first.body.data.id },
      data: { holdExpiresAt: past },
    });
    await db.providerAvailabilitySlot.update({
      where: { id: f.input.slotId },
      data: { holdExpiresAt: past },
    });
    await expireHolds();
    expect(
      (
        await db.booking.findUniqueOrThrow({
          where: { id: first.body.data.id },
        })
      ).status,
    ).toBe("EXPIRED");
    expect((await hold(f.b, { ...f.input, addressId: f.ab.id })).status).toBe(
      201,
    );
    expect((await createPayment(f.a, first.body.data.id)).status).toBe(409);
  });
  it("rejects partial slot overlaps in the service and database trigger", async () => {
    const f = await fixture(),
      existing = f.provider.slots[0],
      start = new Date(existing.startAt.getTime() + 1800000),
      end = new Date(existing.endAt.getTime() + 1800000);
    await expect(
      createAvailability(f.provider.id, start, end),
    ).rejects.toMatchObject({ code: "OVERLAPPING_SLOT" });
    await expect(
      db.providerAvailabilitySlot.create({
        data: { providerId: f.provider.id, startAt: start, endAt: end },
      }),
    ).rejects.toThrow();
    const other = f.provider.slots[1];
    await expect(
      updateAvailability(f.provider.id, other.id, start, end),
    ).rejects.toMatchObject({ code: "OVERLAPPING_SLOT" });
    await expect(
      db.providerAvailabilitySlot.update({
        where: { id: other.id },
        data: { startAt: start, endAt: end },
      }),
    ).rejects.toThrow();
  });
  it("cancels unpaid reservations and releases their slot", async () => {
    const f = await fixture(),
      first = await hold(f.a, f.input);
    const cancelled = await request(app)
      .post("/api/bookings/" + first.body.data.id + "/cancel")
      .auth(f.a.token, { type: "bearer" })
      .send({});
    expect(cancelled.body.data.status).toBe("CANCELLED");
    expect((await hold(f.b, { ...f.input, addressId: f.ab.id })).status).toBe(
      201,
    );
  });
  it("filters provider availability by waste, location, date and time of day", async () => {
    const s = await login();
    const providers = await request(app)
      .get("/api/providers?wasteType=PLASTIC&location=Bengaluru&slot=morning")
      .auth(s.token, { type: "bearer" });
    expect(providers.status).toBe(200);
    expect(providers.body.data.length).toBeGreaterThan(1);
    for (const p of providers.body.data) {
      expect(
        p.wasteTypes.some(
          (w: { wasteType: string }) => w.wasteType === "PLASTIC",
        ),
      ).toBe(true);
      for (const slot of p.slots)
        expect(
          new Date(new Date(slot.startAt).getTime() + 19800000).getUTCHours(),
        ).toBeLessThan(12);
    }
    const partial = await request(app)
      .get("/api/providers?wasteType=PLASTIC&location=beng&slot=morning")
      .auth(s.token, { type: "bearer" });
    expect(partial.status).toBe(200);
    expect(partial.body.data.length).toBe(providers.body.data.length);
    expect(
      partial.body.data.every((p: { slots: unknown[] }) => p.slots.length > 0),
    ).toBe(true);
    const available = await request(app)
      .get(
        `/api/providers/${providers.body.data[0].id}/availability?location=BeNg`,
      )
      .auth(s.token, { type: "bearer" });
    expect(available.status).toBe(200);
    expect(available.body.data.length).toBeGreaterThan(0);
    const elsewhere = await request(app)
      .get(
        `/api/providers/${providers.body.data[0].id}/availability?location=Delhi`,
      )
      .auth(s.token, { type: "bearer" });
    expect(elsewhere.body.data).toHaveLength(0);
    expect(
      (
        await request(app)
          .get("/api/providers?date=2026-02-31")
          .auth(s.token, { type: "bearer" })
      ).status,
    ).toBe(400);
  });
});

describe("verified payment lifecycle", () => {
  it("verifies success idempotently and commits payment, booking and slot together", async () => {
    const f = await fixture(),
      booking = (await hold(f.a, f.input)).body.data;
    const p1 = await createPayment(f.a, booking.id),
      p2 = await createPayment(f.a, booking.id);
    expect(p1.status).toBe(200);
    expect(p1.body.data.providerOrderId).toBe(p2.body.data.providerOrderId);
    const paid = await mockPayment(f.a, booking.id);
    expect(paid.status).toBe(200);
    expect(paid.body.data.status).toBe("PROCESSING");
    expect(paid.body.data.payment.status).toBe("PAID");
    expect((await mockPayment(f.a, booking.id)).body.data.id).toBe(booking.id);
    expect(
      (
        await db.providerAvailabilitySlot.findUniqueOrThrow({
          where: { id: f.input.slotId },
        })
      ).status,
    ).toBe("BOOKED");
    expect(await db.payment.count()).toBe(1);
    expect(await db.booking.count()).toBe(1);
  });
  it("rejects forged callback signatures and leaves the booking unpaid", async () => {
    const f = await fixture(),
      booking = (await hold(f.a, f.input)).body.data,
      payment = (await createPayment(f.a, booking.id)).body.data;
    const response = await request(app)
      .post("/api/payments/verify")
      .auth(f.a.token, { type: "bearer" })
      .send({
        bookingId: booking.id,
        razorpay_order_id: payment.providerOrderId,
        razorpay_payment_id: "pay_fake",
        razorpay_signature: "0".repeat(64),
      });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_SIGNATURE");
    expect(
      (await db.booking.findUniqueOrThrow({ where: { id: booking.id } }))
        .status,
    ).toBe("PAYMENT_PROCESSING");
  });
  it("fails mock payments and releases the hold", async () => {
    const f = await fixture(),
      booking = (await hold(f.a, f.input)).body.data;
    await createPayment(f.a, booking.id);
    const response = await mockPayment(f.a, booking.id, "failure");
    expect(response.body.data.status).toBe("PAYMENT_FAILED");
    expect(response.body.data.payment.status).toBe("FAILED");
    expect((await hold(f.b, { ...f.input, addressId: f.ab.id })).status).toBe(
      201,
    );
  });
  it("verifies raw webhook signatures and deduplicates repeated events", async () => {
    const f = await fixture(),
      booking = (await hold(f.a, f.input)).body.data,
      payment = (await createPayment(f.a, booking.id)).body.data;
    const proof = gateway.capture(
      payment.providerOrderId,
      booking.amount,
      booking.currency,
    );
    const raw = JSON.stringify({
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: proof.razorpay_payment_id,
            order_id: payment.providerOrderId,
            amount: booking.amount,
            currency: booking.currency,
            status: "captured",
          },
        },
      },
    });
    expect(
      (
        await request(app)
          .post("/api/payments/webhook")
          .set("Content-Type", "application/json")
          .set("x-razorpay-signature", "0".repeat(64))
          .send(raw)
      ).status,
    ).toBe(400);
    const send = () =>
      request(app)
        .post("/api/payments/webhook")
        .set("Content-Type", "application/json")
        .set("x-razorpay-signature", hmac(raw, env.OTP_HASH_SECRET))
        .set("x-razorpay-event-id", "evt_123")
        .send(raw);
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    expect(await db.webhookEvent.count()).toBe(1);
    expect(await db.booking.count()).toBe(1);
    expect(
      (await db.booking.findUniqueOrThrow({ where: { id: booking.id } }))
        .status,
    ).toBe("PROCESSING");
  });
  it("records late captured payments for refund without stealing a rebooked slot", async () => {
    const f = await fixture(),
      first = (await hold(f.a, f.input)).body.data,
      payment = (await createPayment(f.a, first.id)).body.data;
    const past = new Date(Date.now() - 1000);
    await db.booking.update({
      where: { id: first.id },
      data: { holdExpiresAt: past },
    });
    await db.providerAvailabilitySlot.update({
      where: { id: f.input.slotId },
      data: { holdExpiresAt: past },
    });
    const second = (await hold(f.b, { ...f.input, addressId: f.ab.id })).body
      .data;
    const proof = gateway.capture(
      payment.providerOrderId,
      first.amount,
      first.currency,
    );
    const result = await request(app)
      .post("/api/payments/verify")
      .auth(f.a.token, { type: "bearer" })
      .send({ bookingId: first.id, ...proof });
    expect(result.status).toBe(200);
    expect(result.body.data.payment.status).toBe("REFUND_REQUIRED");
    expect(result.body.data.status).toBe("EXPIRED");
    expect(
      (
        await db.providerAvailabilitySlot.findUniqueOrThrow({
          where: { id: f.input.slotId },
        })
      ).activeBookingId,
    ).toBe(second.id);
  });
  it("checks Razorpay HMAC signatures with timing-safe comparison", () => {
    const adapter = new RazorpayPaymentProvider();
    const signature = hmac("order_test|pay_test", env.RAZORPAY_KEY_SECRET);
    expect(adapter.verifySignature("order_test", "pay_test", signature)).toBe(
      true,
    );
    expect(adapter.verifySignature("order_other", "pay_test", signature)).toBe(
      false,
    );
    expect(adapter.verifySignature("order_test", "pay_test", "bad")).toBe(
      false,
    );
  });
});

describe("complete acceptance flow", () => {
  it("authenticates A and B, pays A, rejects B on the booked slot, isolates resources, and books A with another provider/address", async () => {
    const f = await fixture();
    const providers = await request(app)
      .get("/api/providers?wasteType=PLASTIC")
      .auth(f.a.token, { type: "bearer" });
    expect(providers.body.data.length).toBeGreaterThan(1);
    const first = (await hold(f.a, f.input)).body.data;
    await createPayment(f.a, first.id);
    expect((await mockPayment(f.a, first.id)).body.data.status).toBe(
      "PROCESSING",
    );
    const orders = await request(app)
      .get("/api/orders")
      .auth(f.a.token, { type: "bearer" });
    expect(orders.body.data[0].status).toBe("PROCESSING");
    expect((await hold(f.b, { ...f.input, addressId: f.ab.id })).status).toBe(
      409,
    );
    expect(
      (
        await request(app)
          .get("/api/orders/" + first.id)
          .auth(f.b.token, { type: "bearer" })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .get("/api/addresses/" + f.ab.id)
          .auth(f.a.token, { type: "bearer" })
      ).status,
    ).toBe(404);
    const other = await db.serviceProvider.findUniqueOrThrow({
      where: { name: "Urban Recycling" },
      include: {
        slots: {
          where: {
            startAt: { gt: new Date(Date.now() + env.HOLD_MINUTES * 60000) },
          },
          orderBy: { startAt: "asc" },
        },
      },
    });
    const secondAddress = await address(f.a, {
      ...addressData,
      label: "Work",
      addressLine1: "85 Office Road",
      postalCode: "560038",
    });
    const second = await hold(f.a, {
      providerId: other.id,
      slotId: other.slots[0].id,
      addressId: secondAddress.id,
      wasteTypes: ["PLASTIC"],
    });
    expect(second.status).toBe(201);
    await createPayment(f.a, second.body.data.id);
    expect((await mockPayment(f.a, second.body.data.id)).body.data.status).toBe(
      "PROCESSING",
    );
    expect(
      (
        await request(app)
          .get("/api/orders")
          .auth(f.a.token, { type: "bearer" })
      ).body.data,
    ).toHaveLength(2);
  });
});

describe("gateway boundary validation", () => {
  it("does not reuse a mock payment order after switching to Razorpay", async () => {
    const f = await fixture();
    const booking = (await hold(f.a, f.input)).body.data;
    await createPayment(f.a, booking.id);
    const switched = createApp({ gateway: new RazorpayPaymentProvider() });
    const response = await request(switched)
      .post("/api/payments/create")
      .auth(f.a.token, { type: "bearer" })
      .send({ bookingId: booking.id });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("PAYMENT_PROVIDER_CHANGED");
    expect(
      (await db.payment.findUniqueOrThrow({ where: { bookingId: booking.id } }))
        .provider,
    ).toBe("mock");
  });

  it.each(["not JSON", JSON.stringify({ id: "order_incomplete" })])(
    "reports malformed upstream orders as gateway failures",
    async (body) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response(body, { status: 200 })),
      );
      try {
        await expect(
          new RazorpayPaymentProvider().createOrder({
            amount: 14900,
            currency: "INR",
            receipt: randomUUID(),
          }),
        ).rejects.toMatchObject({
          status: 502,
          code: "PAYMENT_GATEWAY_INVALID_RESPONSE",
        });
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it("rejects a signed payment with a mismatched captured amount", async () => {
    const f = await fixture();
    const booking = (await hold(f.a, f.input)).body.data;
    const payment = (await createPayment(f.a, booking.id)).body.data;
    const proof = gateway.capture(
      payment.providerOrderId,
      booking.amount + 1,
      booking.currency,
    );
    const response = await request(app)
      .post("/api/payments/verify")
      .auth(f.a.token, { type: "bearer" })
      .send({ bookingId: booking.id, ...proof });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_PAYMENT");
    expect(
      (await db.booking.findUniqueOrThrow({ where: { id: booking.id } }))
        .status,
    ).toBe("PAYMENT_PROCESSING");
  });
  it("creates Razorpay orders server-side and checks captured gateway state", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: "order_test", amount: 14900, currency: "INR" }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "pay_test",
            order_id: "order_test",
            amount: 14900,
            currency: "INR",
            captured: true,
            status: "captured",
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const provider = new RazorpayPaymentProvider();
      expect(
        await provider.createOrder({
          amount: 14900,
          currency: "INR",
          receipt: randomUUID(),
        }),
      ).toMatchObject({ id: "order_test", amount: 14900 });
      expect(fetchMock.mock.calls[0][0]).toBe(
        "https://api.razorpay.com/v1/orders",
      );
      expect(JSON.parse(fetchMock.mock.calls[0][1].body).amount).toBe(14900);
      expect(fetchMock.mock.calls[0][1].headers.Authorization).toMatch(
        /^Basic /,
      );
      expect(await provider.fetchPayment("pay_test")).toMatchObject({
        captured: true,
        orderId: "order_test",
        amount: 14900,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("availability booking cutoff", () => {
  it("does not advertise slots too close to start to hold", async () => {
    const provider = await db.serviceProvider.create({
      data: {
        name: "Cutoff " + randomUUID(),
        description: "Isolated fixture",
        price: 10000,
      },
    });
    const soon = new Date(Date.now() + env.HOLD_MINUTES * 30000);
    const later = new Date(Date.now() + (env.HOLD_MINUTES + 90) * 60000);
    try {
      await db.providerAvailabilitySlot.createMany({
        data: [soon, later].map((startAt) => ({
          providerId: provider.id,
          startAt,
          endAt: new Date(startAt.getTime() + 1800000),
        })),
      });
      const slots = await availability(provider.id, {});
      expect(slots.map((slot) => slot.startAt.toISOString())).toEqual([
        later.toISOString(),
      ]);
    } finally {
      await db.serviceProvider.delete({ where: { id: provider.id } });
    }
  });
});
