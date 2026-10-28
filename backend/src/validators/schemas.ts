/* eslint-disable no-control-regex -- Reject control characters in user-authored plain text. */
import { z } from "zod";
import { parsePhoneNumberFromString } from "libphonenumber-js/mobile";
export const uuid = z.string().uuid();
export const wasteType = z.enum([
  "PLASTIC",
  "FOOD",
  "GREEN_WASTE",
  "PAPER",
  "ELECTRONIC",
  "GENERAL",
]);
export const phone = z
  .string()
  .max(30)
  .transform((value, ctx) => {
    const parsed = parsePhoneNumberFromString(value, "IN");
    if (!parsed?.isValid()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter a valid mobile number with country code.",
      });
      return z.NEVER;
    }
    return parsed.number;
  });
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((s) => !/[<>\x00-\x1f]/.test(s), "Use plain text without HTML.");
export const addressSchema = z
  .object({
    label: text(40),
    contactName: text(100),
    contactPhone: phone,
    addressLine1: text(180),
    addressLine2: z
      .string()
      .trim()
      .max(180)
      .refine((s) => !/[<>\x00-\x1f]/.test(s))
      .default(""),
    city: text(80),
    state: text(80),
    postalCode: z
      .string()
      .regex(/^[1-9][0-9]{5}$/, "Enter a six-digit Indian postal code."),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  })
  .strict();
export const requestOtpSchema = z.object({ phone }).strict();
export const verifyOtpSchema = z
  .object({ challengeId: uuid, phone, code: z.string().regex(/^\d{6}$/) })
  .strict();
export const holdSchema = z
  .object({
    providerId: uuid,
    slotId: uuid,
    addressId: uuid,
    wasteTypes: z
      .array(wasteType)
      .min(1)
      .max(6)
      .refine((v) => new Set(v).size === v.length),
  })
  .strict();
export const bookingRefSchema = z.object({ bookingId: uuid }).strict();
export const verifyPaymentSchema = z
  .object({
    bookingId: uuid,
    razorpay_order_id: z.string().min(1).max(100),
    razorpay_payment_id: z.string().min(1).max(100),
    razorpay_signature: z.string().regex(/^[a-f0-9]{64}$/i),
  })
  .strict();
export const mockSchema = z
  .object({ bookingId: uuid, outcome: z.enum(["success", "failure"]) })
  .strict();
export const filterSchema = z
  .object({
    wasteType: wasteType.optional(),
    location: z.string().trim().max(80).optional(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(
        (v) =>
          !Number.isNaN(Date.parse(v)) &&
          new Date(v).toISOString().slice(0, 10) === v,
      )
      .optional(),
    slot: z.enum(["morning", "afternoon"]).optional(),
  })
  .strict();
export function dateRange(date: string) {
  return {
    gte: new Date(date + "T00:00:00+05:30"),
    lt: new Date(new Date(date + "T00:00:00+05:30").getTime() + 86400000),
  };
}

export const emptySchema = z.object({}).strict();
