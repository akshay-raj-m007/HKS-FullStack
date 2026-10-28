import express, { ErrorRequestHandler } from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import pino from "pino";
import { env } from "./config/env.js";
import { AppError } from "./utils/errors.js";
import { authenticate } from "./middleware/auth.js";
import { ConsoleOtpProvider, OtpDeliveryProvider } from "./otp/provider.js";
import { AuthService } from "./services/auth.js";
import { PaymentService } from "./services/payments.js";
import { MockPaymentProvider } from "./payments/mock.js";
import { RazorpayPaymentProvider } from "./payments/razorpay.js";
import { PaymentProvider } from "./payments/provider.js";
import {
  MemoryRateLimitStore,
  rateLimit,
  RateLimitStore,
} from "./rateLimit/store.js";
import { authRoutes } from "./routes/auth.js";
import { apiRoutes } from "./routes/api.js";
import { db } from "./repositories/db.js";
import { assistantRoutes } from "./assistant/routes.js";
import type { AssistantModel } from "./assistant/model.js";
export const logger = pino({
  enabled: env.NODE_ENV !== "test",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "password",
    "code",
    "token",
  ],
});
export function createApp(
  options: {
    otp?: OtpDeliveryProvider;
    gateway?: PaymentProvider;
    limiter?: RateLimitStore;
    assistantModel?: AssistantModel;
  } = {},
) {
  const app = express();
  app.disable("x-powered-by");
  if (env.NODE_ENV === "production") app.set("trust proxy", 1);
  const store = options.limiter ?? new MemoryRateLimitStore();
  const paymentService = new PaymentService(
    options.gateway ??
      (env.PAYMENT_PROVIDER === "mock"
        ? new MockPaymentProvider()
        : new RazorpayPaymentProvider()),
  );
  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.setHeader("X-Request-Id", req.requestId);
    const start = Date.now();
    res.on("finish", () =>
      logger.info({
        requestId: req.requestId,
        method: req.method,
        route: req.route?.path ?? "unmatched",
        status: res.statusCode,
        durationMs: Date.now() - start,
      }),
    );
    next();
  });
  app.use(
    helmet(
      env.NODE_ENV === "production" ? {} : { strictTransportSecurity: false },
    ),
  );
  app.use(
    cors({
      origin: env.FRONTEND_URL,
      credentials: true,
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "Idempotency-Key",
        "X-Requested-With",
      ],
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    }),
  );
  app.use(
    "/api",
    (_req, res, next) => {
      res.setHeader("Cache-Control", "no-store");
      next();
    },
    rateLimit(store, "api", 300, 60000),
  );
  app.post(
    "/api/payments/webhook",
    express.raw({ type: "application/json", limit: "64kb" }),
    async (req, res) => {
      if (!Buffer.isBuffer(req.body))
        throw new AppError(
          400,
          "INVALID_PAYLOAD",
          "Expected JSON webhook body.",
        );
      const eventId = req.get("x-razorpay-event-id");
      if (eventId && eventId.length > 200)
        throw new AppError(400, "INVALID_PAYLOAD", "Invalid event identifier.");
      await paymentService.webhook(
        req.body,
        req.get("x-razorpay-signature") ?? "",
        eventId,
      );
      res.json({ data: { received: true } });
    },
  );
  app.use((req, _res, next) => {
    const origin = req.get("origin");
    if (origin && origin !== env.FRONTEND_URL)
      return next(
        new AppError(403, "ORIGIN_REJECTED", "Request origin is not allowed."),
      );
    if (
      ["POST", "PATCH", "DELETE"].includes(req.method) &&
      !req.is("application/json")
    )
      return next(
        new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "Send application/json."),
      );
    next();
  });
  // Authenticate before buffering images. This router owns its bounded parsers;
  // existing API JSON/body contracts keep their original 16 KiB limit.
  app.use(
    "/api/assistant",
    authenticate,
    assistantRoutes(store, options.assistantModel, (data) =>
      logger.info(data, "Ask Loop"),
    ),
  );
  app.use(express.json({ limit: "16kb" }));
  app.use(cookieParser());
  app.get("/api/health", async (_req, res) => {
    await db.user.count();
    res.json({ data: { status: "ok", paymentProvider: env.PAYMENT_PROVIDER } });
  });
  app.use(
    "/api/auth",
    authRoutes(new AuthService(options.otp ?? new ConsoleOtpProvider()), store),
  );
  app.use(
    "/api",
    authenticate,
    (_req, res, next) => {
      res.setHeader("Cache-Control", "no-store");
      next();
    },
    apiRoutes(paymentService, store),
  );
  app.use((_req, _res, next) =>
    next(
      new AppError(404, "NOT_FOUND", "The requested endpoint was not found."),
    ),
  );
  const errors: ErrorRequestHandler = (error: unknown, req, res, _next) => {
    let status = 500,
      code = "INTERNAL_ERROR",
      message = "Something went wrong. Please try again.";
    let fields: unknown;
    if (error instanceof AppError) {
      status = error.status;
      code = error.code;
      message = error.message;
    } else if (error instanceof ZodError) {
      status = 400;
      code = "VALIDATION_ERROR";
      message = "Please check the submitted fields.";
      fields = error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      }));
    } else if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      status = 404;
      code = "NOT_FOUND";
      message = "The requested resource was not found.";
    } else if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      status = 409;
      code = "CONFLICT";
      message = "This operation conflicts with an existing record.";
    } else if (
      error &&
      typeof error === "object" &&
      "type" in error &&
      error.type === "entity.too.large"
    ) {
      status = 413;
      code = "BODY_TOO_LARGE";
      message = "Request body is too large.";
    } else if (error instanceof SyntaxError) {
      status = 400;
      code = "INVALID_JSON";
      message = "Request contains invalid JSON.";
    }
    if (status === 500)
      logger.error(
        {
          requestId: req.requestId,
          errorType: error instanceof Error ? error.name : "unknown",
        },
        "Request failed",
      );
    res
      .status(status)
      .json({ error: { code, message, fields, requestId: req.requestId } });
  };
  app.use(errors);
  return app;
}
