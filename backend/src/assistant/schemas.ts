import { z } from "zod";
import { wasteType, uuid } from "../validators/schemas.js";

export const LIMITS = {
  imageBytes: 2 * 1024 * 1024,
  pixels: 8_000_000,
  dimension: 8192,
  deadlineMs: 22000,
  modelMs: 8500,
  modelCalls: 2,
  tools: 8,
  concurrency: 2,
} as const;
export const categories = [
  "PLASTIC",
  "FOOD",
  "GREEN_WASTE",
  "PAPER",
  "ELECTRONIC",
  "GENERAL",
] as const;
export const materialList = z
  .array(wasteType)
  .max(6)
  .refine((v) => new Set(v).size === v.length);
const short = z.string().trim().min(1).max(160);
export const searchRequest = z
  .object({
    message: z.string().trim().min(1).max(1000),
    history: z
      .array(
        z
          .object({
            role: z.enum(["user", "assistant"]),
            text: z.string().max(500),
          })
          .strict(),
      )
      .max(6)
      .default([]),
    materials: materialList.default([]),
    addressId: uuid.optional(),
    location: z.string().trim().min(1).max(80).optional(),
    date: z.string().max(10).optional(),
    photoConfirmation: z
      .object({
        token: z.string().max(2048),
        confirmed: z.boolean(),
        acknowledgeUnresolved: z.boolean(),
      })
      .strict()
      .optional(),
  })
  .strict();
export const decisionSchema = z
  .object({
    intent: z.enum(["search", "clarify", "off_topic", "guidance"]),
    materials: materialList,
    unsupportedItems: z.array(short).max(6),
    addressLabel: z.string().max(40).nullable(),
    location: z.string().max(80).nullable(),
    date: z
      .object({
        kind: z.enum([
          "today",
          "tomorrow",
          "day_after_tomorrow",
          "explicit",
          "unknown",
        ]),
        value: z.string().max(10).nullable(),
      })
      .strict(),
    after: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .nullable(),
    before: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .nullable(),
    sort: z.enum(["cheapest", "earliest"]),
    missing: z.enum(["materials", "location", "date", "details"]).nullable(),
    screen: z.enum(["providers", "addresses", "orders"]).nullable(),
  })
  .strict();
export const observationSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            label: short,
            category: wasteType.nullable(),
            certainty: z.enum(["suggested", "uncertain"]),
          })
          .strict(),
      )
      .max(12),
    unresolvedItems: z.array(short).max(8),
    questions: z.array(short).max(4),
  })
  .strict();
export const photoRequest = z
  .object({
    consent: z.literal(true),
    image: z
      .string()
      .min(16)
      .max(Math.ceil(LIMITS.imageBytes / 3) * 4),
  })
  .strict();
export const querySchema = z
  .object({
    materials: materialList.refine((v) => v.length > 0),
    addressId: uuid.optional(),
    location: z.string().trim().min(1).max(80).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    after: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .nullable(),
    before: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .nullable(),
    sort: z.enum(["cheapest", "earliest"]),
  })
  .strict();
export type SearchInput = z.infer<typeof searchRequest>;
export type SearchQuery = z.infer<typeof querySchema>;
export type Decision = z.infer<typeof decisionSchema>;
export type Observation = z.infer<typeof observationSchema>;
export const addressResult = z
  .object({
    id: uuid,
    label: z.string(),
    city: z.string(),
    postalCode: z.string(),
  })
  .strict();
export const providerResult = z
  .object({
    id: uuid,
    name: z.string().min(1),
    price: z.number().int().nonnegative(),
    currency: z.literal("INR"),
  })
  .strict();
export const slotResult = z
  .object({
    id: uuid,
    providerId: uuid,
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    status: z.literal("AVAILABLE"),
  })
  .strict()
  .refine((slot) => slot.endAt > slot.startAt);
export interface AddressSummary {
  id: string;
  label: string;
  city: string;
  postalCode: string;
}
export interface ProviderSummary {
  id: string;
  name: string;
  price: number;
  currency: string;
}
export interface SlotSummary {
  id: string;
  providerId: string;
  startAt: string;
  endAt: string;
  status: string;
}
export interface SearchResult {
  outcome:
    | "results"
    | "clarification"
    | "unsupported"
    | "no_providers"
    | "no_slots"
    | "guidance"
    | "off_topic";
  message: string;
  date?: string;
  timezone: "Asia/Kolkata";
  materials?: string[];
  addressId?: string;
  providers: (ProviderSummary & { slots: SlotSummary[] })[];
  navigation?: { path: "/providers" | "/addresses" | "/orders"; label: string };
}
