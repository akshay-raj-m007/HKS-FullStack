export const wasteTypes = [
  "PLASTIC",
  "FOOD",
  "GREEN_WASTE",
  "PAPER",
  "ELECTRONIC",
  "GENERAL",
] as const;
export type WasteType = (typeof wasteTypes)[number];
export interface User {
  id: string;
  phone: string;
}
export interface Address {
  id: string;
  label: string;
  contactName: string;
  contactPhone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
}
export interface Slot {
  id: string;
  providerId: string;
  startAt: string;
  endAt: string;
  status: string;
}
export interface Provider {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  rating: number;
  color: string;
  wasteTypes: { wasteType: WasteType }[];
  serviceAreas: { city: string; postalCode: string }[];
  slots: Slot[];
}
export interface Payment {
  id: string;
  provider: "mock" | "razorpay";
  providerOrderId: string;
  status: string;
  amount: number;
  currency: string;
  keyId?: string;
}
export interface Booking {
  id: string;
  providerName: string;
  providerId: string;
  slotId: string;
  addressSnapshot: Address;
  startAt: string;
  endAt: string;
  amount: number;
  currency: string;
  status: string;
  holdExpiresAt: string;
  wasteTypes: { wasteType: WasteType }[];
  payment: Payment | null;
  createdAt: string;
}
