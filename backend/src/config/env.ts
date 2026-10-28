import "dotenv/config";
import { z } from "zod";
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default("127.0.0.1"),
  DATABASE_URL: z.string().regex(/^(file:|postgres(?:ql)?:\/\/)/),
  PUBLIC_DEMO_MODE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  JWT_ACCESS_SECRET: z.string().min(32),
  OTP_HASH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.enum(["5m", "10m", "15m"]).default("15m"),
  REFRESH_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  OTP_PROVIDER: z.literal("console").default("console"),
  PAYMENT_PROVIDER: z.enum(["mock", "razorpay"]).default("mock"),
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),
  RAZORPAY_KEY_ID: z.string().default(""),
  RAZORPAY_KEY_SECRET: z.string().default(""),
  RAZORPAY_WEBHOOK_SECRET: z.string().default(""),
  HOLD_MINUTES: z.coerce.number().int().min(1).max(15).default(10),
});
export const env = schema.parse(process.env);
if (
  env.PAYMENT_PROVIDER === "razorpay" &&
  (!env.RAZORPAY_KEY_ID.startsWith("rzp_test_") ||
    !env.RAZORPAY_KEY_SECRET ||
    !env.RAZORPAY_WEBHOOK_SECRET)
)
  throw new Error("Razorpay requires test keys and a webhook secret.");
if (
  env.NODE_ENV === "production" &&
  (!env.PUBLIC_DEMO_MODE ||
    env.PAYMENT_PROVIDER !== "mock" ||
    !env.DATABASE_URL.startsWith("postgres") ||
    !env.FRONTEND_URL.startsWith("https://"))
)
  throw new Error(
    "Hosted mode requires PUBLIC_DEMO_MODE=true, mock payments, Postgres and an HTTPS frontend. Real customer production remains disabled.",
  );
