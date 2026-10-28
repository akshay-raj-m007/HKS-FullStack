import express, {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { env } from "../config/env.js";
import { AppError } from "../utils/errors.js";
import { rateLimit, type RateLimitStore } from "../rateLimit/store.js";
import { AssistantService } from "./service.js";
import { NvidiaModel, type AssistantModel } from "./model.js";
import { categories, LIMITS, searchRequest, photoRequest } from "./schemas.js";

export function assistantCapability() {
  const configured = !!(env.NVIDIA_API_KEY && env.NVIDIA_CHAT_MODEL);
  return {
    enabled: env.AI_ASSISTANT_ENABLED && configured,
    chat: env.AI_ASSISTANT_ENABLED && configured,
    photo: env.AI_ASSISTANT_ENABLED && configured && !!env.NVIDIA_VISION_MODEL,
    reason: !env.AI_ASSISTANT_ENABLED
      ? "disabled"
      : !configured
        ? "unconfigured"
        : null,
    categories,
    imageMaxBytes: LIMITS.imageBytes,
  };
}
function abortable<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () =>
      reject(
        new AppError(
          504,
          "AI_TIMEOUT",
          "The assistant request was interrupted or timed out. Please retry or use manual search.",
        ),
      );
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    task
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}
export function assistantRoutes(
  store: RateLimitStore,
  model: AssistantModel = new NvidiaModel(),
  log: (data: Record<string, unknown>) => void = () => {},
) {
  const router = Router();
  const service = new AssistantService(model);
  const activeUsers = new Set<string>();
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  router.get("/capabilities", (_req, res) =>
    res.json({ data: assistantCapability() }),
  );
  const task =
    (kind: "search" | "photo") =>
    async (req: Request, res: Response, next: NextFunction) => {
      const started = Date.now();
      const userId = req.auth.userId;
      let acquired = false;
      let outcome = "error";
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), LIMITS.deadlineMs);
      timer.unref();
      const disconnected = () => {
        if (!res.writableEnded) controller.abort();
      };
      res.on("close", disconnected);
      req.on("aborted", disconnected);
      try {
        const cap = assistantCapability();
        if (!cap.enabled || (kind === "photo" && !cap.photo))
          throw new AppError(
            503,
            "ASSISTANT_UNAVAILABLE",
            "Ask Loop is currently unavailable. You can still use ordinary collection search and booking.",
          );
        const limit = await store.increment(
          "assistant-" + kind + ":" + userId,
          60000,
        );
        if (limit.count > (kind === "photo" ? 3 : 8)) {
          res.setHeader(
            "Retry-After",
            Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000)),
          );
          throw new AppError(
            429,
            "AI_RATE_LIMITED",
            "Please wait before sending another assistant request.",
          );
        }
        if (activeUsers.has(userId) || activeUsers.size >= LIMITS.concurrency) {
          res.setHeader("Retry-After", "2");
          throw new AppError(
            429,
            "AI_BUSY",
            "Another analysis is in progress. Wait a moment or use manual search.",
          );
        }
        activeUsers.add(userId);
        acquired = true;
        const operation = (async () => {
          await new Promise<void>((resolve, reject) =>
            express.json({ limit: kind === "photo" ? "2800kb" : "16kb" })(
              req,
              res,
              (error?: unknown) => (error ? reject(error) : resolve()),
            ),
          );
          if (kind === "photo") {
            const input = photoRequest.parse(req.body);
            return service.photo(userId, input.image, controller.signal);
          }
          return service.search(
            userId,
            searchRequest.parse(req.body),
            controller.signal,
          );
        })();
        const data = await abortable(operation, controller.signal);
        if (!res.destroyed) {
          outcome = "ok";
          res.json({ data });
        }
      } catch (error) {
        outcome =
          error instanceof AppError ? error.code : "validation_or_internal";
        if (!res.destroyed && !res.headersSent) next(error);
        if (!req.complete) res.once("finish", () => req.destroy());
      } finally {
        clearTimeout(timer);
        controller.abort();
        res.removeListener("close", disconnected);
        req.removeListener("aborted", disconnected);
        if (acquired) activeUsers.delete(userId);
        log({
          requestId: req.requestId,
          operation: kind,
          model:
            kind === "photo" ? env.NVIDIA_VISION_MODEL : env.NVIDIA_CHAT_MODEL,
          outcome,
          latencyMs: Date.now() - started,
        });
      }
    };
  router.post(
    "/search",
    rateLimit(store, "assistant-search-ip", 20, 60000),
    task("search"),
  );
  router.post(
    "/photo",
    rateLimit(store, "assistant-photo-ip", 8, 60000),
    task("photo"),
  );
  return router;
}
