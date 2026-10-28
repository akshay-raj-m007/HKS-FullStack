import type { RequestHandler } from "express";
import { AppError } from "../utils/errors.js";
export interface RateLimitStore {
  increment(
    key: string,
    windowMs: number,
  ): Promise<{ count: number; resetAt: number }>;
}
export class MemoryRateLimitStore implements RateLimitStore {
  private entries = new Map<string, { count: number; resetAt: number }>();
  async increment(key: string, windowMs: number) {
    const now = Date.now();
    for (const [k, v] of this.entries)
      if (v.resetAt <= now) this.entries.delete(k);
    const value = this.entries.get(key) ?? {
      count: 0,
      resetAt: now + windowMs,
    };
    value.count++;
    this.entries.set(key, value);
    return value;
  }
}
export function rateLimit(
  store: RateLimitStore,
  prefix: string,
  limit: number,
  windowMs: number,
): RequestHandler {
  return async (req, res, next) => {
    try {
      const value = await store.increment(
        prefix + ":" + (req.ip ?? "unknown"),
        windowMs,
      );
      res.setHeader("RateLimit-Limit", limit);
      res.setHeader("RateLimit-Remaining", Math.max(0, limit - value.count));
      if (value.count > limit) {
        res.setHeader(
          "Retry-After",
          Math.ceil((value.resetAt - Date.now()) / 1000),
        );
        throw new AppError(
          429,
          "RATE_LIMITED",
          "Too many requests. Please try again shortly.",
        );
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
