import { Router } from "express";
import { env } from "../config/env.js";
import { AuthService } from "../services/auth.js";
import {
  emptySchema,
  requestOtpSchema,
  verifyOtpSchema,
} from "../validators/schemas.js";
import { rateLimit, RateLimitStore } from "../rateLimit/store.js";
import { assert } from "../utils/errors.js";
const cookieOptions = {
  httpOnly: true,
  sameSite: "strict" as const,
  secure: env.NODE_ENV === "production",
  path: "/api/auth",
  maxAge: env.REFRESH_DAYS * 86400000,
};
export function authRoutes(service: AuthService, store: RateLimitStore) {
  const router = Router();
  router.post(
    "/demo",
    rateLimit(store, "demo-entry", 10, 3600000),
    async (req, res) => {
      assert(
        env.PUBLIC_DEMO_MODE,
        404,
        "NOT_FOUND",
        "This endpoint is unavailable.",
      );
      emptySchema.parse(req.body);
      const { refreshToken, ...session } = await service.demo();
      res
        .cookie("refreshToken", refreshToken, cookieOptions)
        .json({ data: session });
    },
  );
  router.post(
    "/request-otp",
    rateLimit(store, "otp-request", 10, 3600000),
    async (req, res) => {
      assert(
        !env.PUBLIC_DEMO_MODE,
        403,
        "DEMO_ONLY",
        "Use the demo entry button. No real phone verification is offered here.",
      );
      const input = requestOtpSchema.parse(req.body);
      res.json({ data: await service.requestOtp(input.phone) });
    },
  );
  router.post(
    "/verify-otp",
    rateLimit(store, "otp-verify", 30, 900000),
    async (req, res) => {
      assert(
        !env.PUBLIC_DEMO_MODE,
        403,
        "DEMO_ONLY",
        "Use the demo entry button.",
      );
      const input = verifyOtpSchema.parse(req.body);
      const { refreshToken, ...session } = await service.verifyOtp(
        input.phone,
        input.challengeId,
        input.code,
      );
      res
        .cookie("refreshToken", refreshToken, cookieOptions)
        .json({ data: session });
    },
  );
  router.post(
    "/refresh",
    rateLimit(store, "refresh", 30, 60000),
    async (req, res) => {
      assert(
        req.get("X-Requested-With") === "Loop",
        403,
        "CSRF_REJECTED",
        "A same-origin application request is required.",
      );
      emptySchema.parse(req.body);
      const token: unknown = req.cookies.refreshToken;
      assert(
        typeof token === "string" && token.length < 200,
        401,
        "INVALID_SESSION",
        "Please sign in.",
      );
      const { refreshToken, ...session } = await service.refresh(token);
      res
        .cookie("refreshToken", refreshToken, cookieOptions)
        .json({ data: session });
    },
  );
  router.post("/logout", async (req, res) => {
    emptySchema.parse(req.body);
    assert(
      req.get("X-Requested-With") === "Loop",
      403,
      "CSRF_REJECTED",
      "A same-origin application request is required.",
    );
    const token: unknown = req.cookies.refreshToken;
    if (typeof token === "string" && token.length < 200)
      await service.logout(token);
    res
      .clearCookie("refreshToken", { ...cookieOptions, maxAge: undefined })
      .json({ data: { loggedOut: true } });
  });
  return router;
}
