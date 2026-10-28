import jwt from "jsonwebtoken";
import { randomBytes, randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { hash } from "../utils/crypto.js";
import type { Prisma } from "@prisma/client";
export function accessToken(userId: string) {
  return jwt.sign({}, env.JWT_ACCESS_SECRET, {
    subject: userId,
    algorithm: "HS256",
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
    issuer: "loop-api",
    audience: "loop-web",
  });
}
export function verifyAccess(token: string) {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
    algorithms: ["HS256"],
    issuer: "loop-api",
    audience: "loop-web",
  });
  if (
    typeof payload === "string" ||
    typeof payload.sub !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(payload.sub)
  )
    throw new Error("Invalid token");
  return payload.sub;
}
export async function createRefresh(
  tx: Prisma.TransactionClient,
  userId: string,
  familyId: string = randomUUID(),
) {
  const token = randomBytes(48).toString("base64url");
  await tx.refreshToken.create({
    data: {
      userId,
      familyId,
      tokenHash: hash(token),
      expiresAt: new Date(Date.now() + env.REFRESH_DAYS * 86400000),
    },
  });
  return token;
}
