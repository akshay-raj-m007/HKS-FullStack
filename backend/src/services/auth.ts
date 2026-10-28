import { randomInt, randomUUID } from "node:crypto";
import { db, transaction } from "../repositories/db.js";
import { env } from "../config/env.js";
import { hmac, safeEqual, hash } from "../utils/crypto.js";
import { AppError, assert } from "../utils/errors.js";
import { accessToken, createRefresh } from "../security/tokens.js";
import type { OtpDeliveryProvider } from "../otp/provider.js";
const otpHash = (phone: string, code: string) =>
  hmac(phone + ":" + code, env.OTP_HASH_SECRET);
export class AuthService {
  constructor(private delivery: OtpDeliveryProvider) {}
  async demo() {
    assert(
      env.PUBLIC_DEMO_MODE,
      404,
      "NOT_FOUND",
      "This endpoint is unavailable.",
    );
    return transaction(async (tx) => {
      const id = randomUUID();
      const user = await tx.user.create({
        data: {
          id,
          phone: "demo:" + id,
          addresses: {
            create: {
              label: "Home",
              contactName: "Ananya Sharma",
              contactPhone: "+919876543210",
              addressLine1: "14, 3rd Cross, Indiranagar",
              addressLine2: "Near 100 Feet Road",
              city: "Bengaluru",
              state: "Karnataka",
              postalCode: "560038",
            },
          },
        },
        select: { id: true, phone: true },
      });
      return {
        user,
        accessToken: accessToken(user.id),
        refreshToken: await createRefresh(tx, user.id),
      };
    });
  }
  async requestOtp(phone: string) {
    const code = String(randomInt(100000, 1000000));
    const challenge = await transaction(async (tx) => {
      const recent = await tx.otpChallenge.findFirst({
        where: { phone },
        orderBy: { createdAt: "desc" },
      });
      assert(
        !recent || recent.createdAt.getTime() < Date.now() - 60000,
        429,
        "OTP_RESEND_LIMIT",
        "Wait 60 seconds before requesting another code.",
      );
      const count = await tx.otpChallenge.count({
        where: { phone, createdAt: { gt: new Date(Date.now() - 3600000) } },
      });
      assert(
        count < 5,
        429,
        "OTP_RESEND_LIMIT",
        "Too many codes requested. Try again in an hour.",
      );
      await tx.otpChallenge.updateMany({
        where: { phone, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      return tx.otpChallenge.create({
        data: {
          phone,
          codeHash: otpHash(phone, code),
          expiresAt: new Date(Date.now() + 300000),
        },
      });
    });
    await this.delivery.send(phone, code);
    return { challengeId: challenge.id, expiresIn: 300, resendAfter: 60 };
  }
  async verifyOtp(phone: string, challengeId: string, code: string) {
    const result = await transaction(async (tx) => {
      const challenge = await tx.otpChallenge.findFirst({
        where: { id: challengeId, phone },
      });
      if (
        !challenge ||
        challenge.consumedAt ||
        challenge.expiresAt <= new Date() ||
        challenge.attempts >= 5
      )
        return null;
      const attempted = await tx.otpChallenge.updateMany({
        where: {
          id: challengeId,
          consumedAt: null,
          attempts: { lt: 5 },
          expiresAt: { gt: new Date() },
        },
        data: { attempts: { increment: 1 } },
      });
      if (
        !attempted.count ||
        !safeEqual(challenge.codeHash, otpHash(phone, code))
      )
        return null;
      const consumed = await tx.otpChallenge.updateMany({
        where: { id: challengeId, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      if (!consumed.count) return null;
      const user = await tx.user.upsert({
        where: { phone },
        create: { phone },
        update: {},
      });
      return {
        user,
        accessToken: accessToken(user.id),
        refreshToken: await createRefresh(tx, user.id),
      };
    });
    if (!result)
      throw new AppError(
        401,
        "INVALID_OTP",
        "This code is incorrect, expired, or has too many attempts.",
      );
    return result;
  }
  async refresh(token: string) {
    const result = await transaction(async (tx) => {
      const old = await tx.refreshToken.findUnique({
        where: { tokenHash: hash(token) },
      });
      if (!old) return null;
      if (old.revokedAt) {
        await tx.refreshToken.updateMany({
          where: { familyId: old.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        return null;
      }
      if (old.expiresAt <= new Date()) return null;
      const changed = await tx.refreshToken.updateMany({
        where: { id: old.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (!changed.count) return null;
      const user = await tx.user.findUniqueOrThrow({
        where: { id: old.userId },
      });
      return {
        user,
        accessToken: accessToken(user.id),
        refreshToken: await createRefresh(tx, user.id, old.familyId),
      };
    });
    if (!result)
      throw new AppError(
        401,
        "INVALID_SESSION",
        "Your session has expired. Please sign in again.",
      );
    return result;
  }
  async logout(token: string) {
    const session = await db.refreshToken.findUnique({
      where: { tokenHash: hash(token) },
    });
    if (session)
      await db.refreshToken.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
  }
}
