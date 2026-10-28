import type { WasteType, Slot } from "../../types";
export interface Capability {
  enabled: boolean;
  chat: boolean;
  photo: boolean;
  reason: string | null;
  categories: WasteType[];
  imageMaxBytes: number;
}
export interface PhotoResult {
  items: {
    label: string;
    category: WasteType | null;
    certainty: "suggested" | "uncertain";
  }[];
  unresolvedItems: string[];
  questions: string[];
  confirmationToken: string;
  message: string;
}
export interface SearchResult {
  outcome: string;
  message: string;
  date?: string;
  timezone: string;
  materials?: WasteType[];
  addressId?: string;
  providers: {
    id: string;
    name: string;
    price: number;
    currency: string;
    slots: Slot[];
  }[];
  navigation?: { path: string; label: string };
}
