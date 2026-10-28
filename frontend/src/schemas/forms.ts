import { z } from "zod";
import { parsePhoneNumberFromString } from "libphonenumber-js/mobile";

export const mobileNumber = z
  .string()
  .trim()
  .max(30)
  .refine(
    (value) => parsePhoneNumberFromString(value, "IN")?.isValid() === true,
    "Enter a valid mobile number.",
  );

export const addressSchema = z.object({
  label: z.string().trim().min(1, "Give this address a name.").max(40),
  contactName: z.string().trim().min(1, "Enter a contact name.").max(100),
  contactPhone: mobileNumber,
  addressLine1: z.string().trim().min(3, "Enter your street address.").max(180),
  addressLine2: z.string().max(180),
  city: z.string().trim().min(1, "Enter a city.").max(80),
  state: z.string().trim().min(1, "Enter a state.").max(80),
  postalCode: z
    .string()
    .regex(/^[1-9]\d{5}$/, "Enter a six-digit postal code."),
});
export type AddressInput = z.infer<typeof addressSchema>;
export const bookingSchema = z.object({
  addressId: z.string().uuid("Select a pickup address."),
  slotId: z.string().uuid("Select a time slot."),
  wasteTypes: z
    .array(
      z.enum([
        "PLASTIC",
        "FOOD",
        "GREEN_WASTE",
        "PAPER",
        "ELECTRONIC",
        "GENERAL",
      ]),
    )
    .min(1, "Select at least one waste type."),
});
