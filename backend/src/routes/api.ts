import { Router } from "express";
import { db } from "../repositories/db.js";
import { owned } from "../repositories/owned.js";
import { addresses } from "../services/addresses.js";
import {
  providerList,
  providerDetail,
  availability,
} from "../services/providers.js";
import {
  holdBooking,
  listBookings,
  getBooking,
  cancelBooking,
} from "../services/bookings.js";
import { PaymentService } from "../services/payments.js";
import {
  emptySchema,
  uuid,
  addressSchema,
  filterSchema,
  holdSchema,
  bookingRefSchema,
  verifyPaymentSchema,
  mockSchema,
} from "../validators/schemas.js";
import { rateLimit, RateLimitStore } from "../rateLimit/store.js";
import { assert } from "../utils/errors.js";
export function apiRoutes(payments: PaymentService, store: RateLimitStore) {
  const router = Router();
  router.get("/me", async (req, res) =>
    res.json({
      data: await db.user.findUniqueOrThrow({
        where: { id: req.auth.userId },
        select: { id: true, phone: true, createdAt: true },
      }),
    }),
  );
  router.get("/addresses", async (req, res) =>
    res.json({ data: await addresses.list(req.auth.userId) }),
  );
  router.post("/addresses", async (req, res) =>
    res.status(201).json({
      data: await addresses.create(
        req.auth.userId,
        addressSchema.parse(req.body),
      ),
    }),
  );
  router.get("/addresses/:id", async (req, res) =>
    res.json({
      data: await owned.address(req.auth.userId, uuid.parse(req.params.id)),
    }),
  );
  router.patch("/addresses/:id", async (req, res) =>
    res.json({
      data: await addresses.update(
        req.auth.userId,
        uuid.parse(req.params.id),
        addressSchema.parse(req.body),
      ),
    }),
  );
  router.delete("/addresses/:id", async (req, res) => {
    emptySchema.parse(req.body);
    await addresses.remove(req.auth.userId, uuid.parse(req.params.id));
    res.status(204).end();
  });
  router.get("/providers", async (req, res) =>
    res.json({ data: await providerList(filterSchema.parse(req.query)) }),
  );
  router.get("/providers/:id", async (req, res) =>
    res.json({ data: await providerDetail(uuid.parse(req.params.id)) }),
  );
  router.get("/providers/:id/availability", async (req, res) =>
    res.json({
      data: await availability(
        uuid.parse(req.params.id),
        filterSchema.parse(req.query),
      ),
    }),
  );
  router.post("/bookings/hold", async (req, res) => {
    const key = req.get("Idempotency-Key");
    assert(
      key && /^[a-zA-Z0-9_-]{16,100}$/.test(key),
      400,
      "INVALID_IDEMPOTENCY_KEY",
      "Provide a unique Idempotency-Key header (16-100 characters).",
    );
    res.status(201).json({
      data: await holdBooking(req.auth.userId, holdSchema.parse(req.body), key),
    });
  });
  router.get(["/bookings", "/orders"], async (req, res) =>
    res.json({ data: await listBookings(req.auth.userId) }),
  );
  router.get(["/bookings/:id", "/orders/:id"], async (req, res) =>
    res.json({
      data: await getBooking(req.auth.userId, uuid.parse(req.params.id)),
    }),
  );
  router.post("/bookings/:id/cancel", async (req, res) => {
    emptySchema.parse(req.body);
    res.json({
      data: await cancelBooking(req.auth.userId, uuid.parse(req.params.id)),
    });
  });
  router.post(
    "/payments/create",
    rateLimit(store, "payment-create", 20, 60000),
    async (req, res) =>
      res.json({
        data: await payments.create(
          req.auth.userId,
          bookingRefSchema.parse(req.body).bookingId,
        ),
      }),
  );
  router.post(
    "/payments/verify",
    rateLimit(store, "payment-verify", 30, 60000),
    async (req, res) =>
      res.json({
        data: await payments.verify(
          req.auth.userId,
          verifyPaymentSchema.parse(req.body),
        ),
      }),
  );
  router.post(
    "/payments/mock",
    rateLimit(store, "payment-mock", 20, 60000),
    async (req, res) => {
      const input = mockSchema.parse(req.body);
      res.json({
        data: await payments.mock(
          req.auth.userId,
          input.bookingId,
          input.outcome,
        ),
      });
    },
  );
  router.get("/payments/:id", async (req, res) =>
    res.json({
      data: await owned.payment(req.auth.userId, uuid.parse(req.params.id)),
    }),
  );
  return router;
}
