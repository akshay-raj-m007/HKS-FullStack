import type { RequestHandler } from "express";
import { verifyAccess } from "../security/tokens.js";
import { AppError } from "../utils/errors.js";
declare module "express-serve-static-core" {
  interface Request {
    auth: { userId: string };
    requestId: string;
  }
}
export const authenticate: RequestHandler = (req, _res, next) => {
  try {
    const match = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "");
    if (!match) throw new Error("Missing token");
    req.auth = { userId: verifyAccess(match[1]) };
    next();
  } catch {
    next(new AppError(401, "UNAUTHORIZED", "Please sign in to continue."));
  }
};
