import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { db } from "../repositories/db.js";
import { owned } from "../repositories/owned.js";
import {
  providerList,
  availability,
  acceptsMaterials,
  coversAddress,
} from "../services/providers.js";
import { env } from "../config/env.js";
import { AppError } from "../utils/errors.js";
import {
  LIMITS,
  categories,
  querySchema,
  type SearchQuery,
} from "./schemas.js";
import { indianDay, matchesTime, resolveDay } from "./time.js";

export const TOOL_NAMES = [
  "get_waste_categories",
  "list_my_addresses",
  "find_eligible_providers",
  "get_available_slots",
] as const;
export async function connectReadOnlyTools(
  userId: string,
  signal: AbortSignal,
) {
  const server = new McpServer({ name: "loop-read-only", version: "1.0.0" });
  const client = new Client({ name: "loop-assistant", version: "1.0.0" });
  let calls = 0;
  const selected = new Set<string>();
  let selectedQuery: string | null = null;
  const read = <T>(data: T) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
  });
  const annotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
  server.registerTool(
    "get_waste_categories",
    { inputSchema: z.object({}).strict(), annotations },
    async () => read(categories),
  );
  server.registerTool(
    "list_my_addresses",
    { inputSchema: z.object({}).strict(), annotations },
    async () =>
      read(
        await db.userAddress.findMany({
          where: { userId },
          select: { id: true, label: true, city: true, postalCode: true },
          take: 20,
          orderBy: { createdAt: "desc" },
        }),
      ),
  );
  server.registerTool(
    "find_eligible_providers",
    { inputSchema: querySchema, annotations },
    async (query) => {
      const parsed = querySchema.parse(query);
      resolveDay({ kind: "unknown", value: null }, parsed.date, "");
      if (parsed.after && parsed.before && parsed.after >= parsed.before)
        throw new AppError(
          400,
          "ASSISTANT_INVALID_TIME",
          "Choose a time window that ends after it starts.",
        );
      const address = parsed.addressId
        ? await owned.address(userId, parsed.addressId)
        : undefined;
      if (!address && !parsed.location)
        throw new AppError(
          400,
          "ASSISTANT_LOCATION_REQUIRED",
          "Choose an owned address or a city/postal code.",
        );
      // cleanup=false is deliberate: MCP cannot expire holds or mutate any rows.
      const entries = await providerList(
        address ? {} : { location: parsed.location },
        false,
        false,
      );
      const eligible = entries.filter(
        (provider) =>
          acceptsMaterials(provider.wasteTypes, parsed.materials) &&
          (!address || coversAddress(provider.serviceAreas, address)),
      );
      const first = (provider: (typeof eligible)[number]) =>
        provider.slots
          .filter(
            (slot) =>
              indianDay(slot.startAt) === parsed.date &&
              slot.startAt.getTime() > Date.now() + env.HOLD_MINUTES * 60000 &&
              matchesTime(slot.startAt, parsed.after, parsed.before),
          )[0]
          ?.startAt.getTime() ?? Infinity;
      eligible.sort(
        (a, b) =>
          Number(!Number.isFinite(first(a))) -
            Number(!Number.isFinite(first(b))) ||
          (parsed.sort === "cheapest"
            ? a.price - b.price
            : first(a) - first(b)) ||
          a.name.localeCompare(b.name),
      );
      // Earliest ordering must consider every eligible provider, not just five.
      // The catalog cap is explicit; refuse an oversized catalog rather than guess.
      if (eligible.length > 50)
        throw new AppError(
          503,
          "ASSISTANT_LOOKUP_FAILED",
          "Please narrow the collection search.",
        );
      // The ordinary listing bounds slots at 100. Refresh the requested day before
      // ranking so nearer dates cannot hide later providers in a busy catalog.
      await Promise.all(
        eligible.map(async (provider) => {
          provider.slots = await availability(
            provider.id,
            { date: parsed.date },
            false,
          );
        }),
      );
      eligible.sort(
        (a, b) =>
          Number(!Number.isFinite(first(a))) -
            Number(!Number.isFinite(first(b))) ||
          (parsed.sort === "cheapest"
            ? a.price - b.price
            : first(a) - first(b)) ||
          a.name.localeCompare(b.name),
      );
      const limited = eligible.slice(0, 5);
      selectedQuery = JSON.stringify(parsed);
      selected.clear();
      for (const provider of limited) selected.add(provider.id);
      return read(
        limited.map(({ id, name, price, currency }) => ({
          id,
          name,
          price,
          currency,
        })),
      );
    },
  );
  const slotArgs = querySchema
    .extend({ providerId: z.string().uuid() })
    .strict();
  server.registerTool(
    "get_available_slots",
    { inputSchema: slotArgs, annotations },
    async ({ providerId, ...query }) => {
      if (!selected.has(providerId))
        throw new AppError(
          400,
          "ASSISTANT_TOOL_REJECTED",
          "Select an eligible provider first.",
        );
      if (JSON.stringify(query) !== selectedQuery)
        throw new AppError(
          400,
          "ASSISTANT_TOOL_REJECTED",
          "Search preferences must match the selected providers.",
        );
      const result = await availability(
        providerId,
        { date: query.date },
        false,
      );
      return read(
        result.filter(
          (slot) =>
            slot.startAt.getTime() > Date.now() + env.HOLD_MINUTES * 60000 &&
            matchesTime(slot.startAt, query.after, query.before),
        ),
      );
    },
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  } catch {
    await Promise.allSettled([client.close(), server.close()]);
    throw new AppError(
      503,
      "ASSISTANT_LOOKUP_FAILED",
      "Provider lookup could not start. Try manual search.",
    );
  }
  return {
    async call<T>(
      name: string,
      args: Record<string, unknown> = {},
    ): Promise<T> {
      signal.throwIfAborted();
      if (
        !(TOOL_NAMES as readonly string[]).includes(name) ||
        ++calls > LIMITS.tools
      )
        throw new AppError(
          400,
          "ASSISTANT_TOOL_REJECTED",
          "This assistant action is not supported or its execution budget was exceeded.",
        );
      try {
        const result = z
          .object({
            isError: z.boolean().optional(),
            content: z.array(
              z
                .object({ type: z.string(), text: z.string().optional() })
                .passthrough(),
            ),
          })
          .parse(
            await client.callTool({ name, arguments: args }, undefined, {
              signal,
              timeout: 5000,
            }),
          );
        if (result.isError) throw new Error();
        const text = result.content.find((item) => item.type === "text");
        if (!text || typeof text.text !== "string" || text.text.length > 65536)
          throw new Error();
        return JSON.parse(text.text) as T;
      } catch {
        throw new AppError(
          503,
          "ASSISTANT_LOOKUP_FAILED",
          "I couldn't check providers or availability right now. Please retry or use manual search.",
        );
      }
    },
    get calls() {
      return calls;
    },
    close: () => Promise.allSettled([client.close(), server.close()]),
  };
}
export type ToolSession = Awaited<ReturnType<typeof connectReadOnlyTools>>;
export type ToolQuery = SearchQuery;
