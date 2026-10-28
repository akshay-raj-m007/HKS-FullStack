import { AppError } from "../utils/errors.js";
import { connectReadOnlyTools } from "./mcp.js";
import {
  decisionSchema,
  observationSchema,
  categories,
  type AddressSummary,
  type ProviderSummary,
  type SlotSummary,
  type SearchInput,
  type SearchResult,
} from "./schemas.js";
import { indianDay, resolveDay } from "./time.js";
import {
  verifyPhotoConfirmation,
  photoToken,
  normalizeImage,
} from "./photo.js";
import { SCOPE_REPLY, type AssistantModel } from "./model.js";
import { owned } from "../repositories/owned.js";
import { z } from "zod";
import { addressResult, providerResult, slotResult } from "./schemas.js";

export class AssistantService {
  constructor(private model: AssistantModel) {}
  async photo(userId: string, data: string, signal: AbortSignal) {
    const jpeg = await normalizeImage(data, signal);
    try {
      const parsed = observationSchema.safeParse(
        await this.model.observe(jpeg, signal),
      );
      if (!parsed.success)
        throw new AppError(
          502,
          "AI_INVALID_OUTPUT",
          "The image result was unreliable. Please select materials manually.",
        );
      return {
        ...parsed.data,
        confirmationToken: photoToken(userId, parsed.data),
        categories,
        message:
          "AI suggestions need your review. Appearance cannot establish weight, composition, contamination, hazards or provider acceptance.",
      };
    } finally {
      jpeg.fill(0);
    }
  }
  async search(
    userId: string,
    input: SearchInput,
    signal: AbortSignal,
  ): Promise<SearchResult> {
    verifyPhotoConfirmation(userId, input);
    if (input.addressId) await owned.address(userId, input.addressId);
    const tools = await connectReadOnlyTools(userId, signal);
    const result = (
      outcome: SearchResult["outcome"],
      message: string,
    ): SearchResult => ({
      outcome,
      message,
      providers: [],
      timezone: "Asia/Kolkata",
    });
    try {
      const allowedCategories = await tools.call<string[]>(
        "get_waste_categories",
      );
      const addresses: AddressSummary[] = z
        .array(addressResult)
        .max(20)
        .parse(await tools.call("list_my_addresses"));
      const parsed = decisionSchema.safeParse(
        await this.model.plan(
          {
            message: input.message,
            history: input.history,
            todayInIndia: indianDay(),
            categories: allowedCategories,
            // Never send street address, contact name/phone, credentials or UUIDs.
            addressLabels: addresses.map(({ label, city, postalCode }) => ({
              label,
              city,
              postalCode,
            })),
            confirmedMaterials: input.materials,
          },
          signal,
        ),
      );
      if (!parsed.success)
        throw new AppError(
          502,
          "AI_INVALID_OUTPUT",
          "The AI could not interpret the request reliably. Try simpler details or manual search.",
        );
      const decision = parsed.data;
      if (decision.intent === "off_topic")
        return result("off_topic", SCOPE_REPLY);
      if (decision.intent === "guidance") {
        const screen = decision.screen ?? "providers";
        return {
          ...result(
            "guidance",
            "I can help search, but cannot make changes or perform payments. Continue in the existing Loop screen.",
          ),
          navigation: {
            path: ("/" + screen) as "/providers" | "/addresses" | "/orders",
            label: "Open " + screen,
          },
        };
      }
      if (decision.unsupportedItems.length)
        return result(
          "unsupported",
          "Some materials are unsupported or uncertain. Please identify every item using Loop's six categories, or use manual search. I won't silently exclude mixed items.",
        );
      if (decision.intent === "clarify" && decision.missing === "details")
        return result(
          "clarification",
          "Please clarify which items need collection or select their materials manually.",
        );
      const materials = input.materials.length
        ? input.materials
        : decision.materials;
      if (!materials.length)
        return result(
          "clarification",
          "Which materials need collecting: paper, plastic, food, garden, electronic or general waste?",
        );
      let addressId = input.addressId;
      if (!addressId && decision.addressLabel) {
        const matches = addresses.filter(
          (address) =>
            address.label.toLowerCase() ===
            decision.addressLabel!.trim().toLowerCase(),
        );
        if (matches.length !== 1)
          return result(
            "clarification",
            "Which saved address do you mean? Choose an address below, or enter its city/postal code.",
          );
        addressId = matches[0].id;
      }
      const location = input.location || decision.location || undefined;
      if (!addressId && !location)
        return result(
          "clarification",
          "Where should collection happen? Choose your saved address or enter a city or postal code.",
        );
      const text = [
        input.message,
        ...input.history
          .filter((entry) => entry.role === "user")
          .map((entry) => entry.text),
      ].join("\n");
      const date = resolveDay(decision.date, input.date, text);
      if (!date)
        return result(
          "clarification",
          "Which pickup date in India time? Say today, tomorrow, or enter YYYY-MM-DD.",
        );
      if (
        decision.after &&
        decision.before &&
        decision.after >= decision.before
      )
        throw new AppError(
          400,
          "ASSISTANT_INVALID_TIME",
          "Choose a time window that ends after it starts.",
        );
      const query = {
        materials,
        ...(addressId ? { addressId } : { location }),
        date,
        after: decision.after,
        before: decision.before,
        sort: decision.sort,
      };
      const providers: ProviderSummary[] = z
        .array(providerResult)
        .max(5)
        .parse(await tools.call("find_eligible_providers", query));
      if (!providers.length)
        return {
          ...result(
            "no_providers",
            "No catalog provider covers that location and every confirmed category. Try a different location or manual search.",
          ),
          date,
          materials,
          addressId,
        };
      const cards = [];
      for (const provider of providers) {
        const slots: SlotSummary[] = z
          .array(slotResult)
          .max(100)
          .parse(
            await tools.call("get_available_slots", {
              ...query,
              providerId: provider.id,
            }),
          );
        if (slots.some((slot) => slot.providerId !== provider.id))
          throw new AppError(
            503,
            "ASSISTANT_LOOKUP_FAILED",
            "Availability could not be checked reliably. Please use manual search.",
          );
        if (slots.length) cards.push({ ...provider, slots: slots.slice(0, 3) });
      }
      cards.sort((a, b) =>
        decision.sort === "cheapest"
          ? a.price - b.price ||
            a.slots[0].startAt.localeCompare(b.slots[0].startAt)
          : a.slots[0].startAt.localeCompare(b.slots[0].startAt) ||
            a.price - b.price,
      );
      return {
        ...result(
          cards.length ? "results" : "no_slots",
          cards.length
            ? "These options match every selected category and catalog coverage. Availability is provisional until you reserve in the booking form."
            : "Eligible providers exist, but no live slots match that date and time. Try another time or date.",
        ),
        date,
        materials,
        addressId,
        providers: cards,
      };
    } finally {
      await tools.close();
    }
  }
}
