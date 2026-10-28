import { AppError } from "../utils/errors.js";
import { filterSchema } from "../validators/schemas.js";
import type { Decision } from "./schemas.js";

export const indianDay = (date = new Date()) =>
  new Date(date.getTime() + 19800000).toISOString().slice(0, 10);
export function resolveDay(
  preference: Decision["date"],
  explicit: string | undefined,
  userText: string,
  now = new Date(),
): string | null {
  const today = indianDay(now);
  let result = explicit;
  if (!result && preference.kind === "explicit") {
    if (!preference.value || !userText.includes(preference.value)) return null;
    result = preference.value;
  }
  if (
    !result &&
    preference.kind !== "unknown" &&
    preference.kind !== "explicit"
  ) {
    const offset = { today: 0, tomorrow: 1, day_after_tomorrow: 2 }[
      preference.kind
    ];
    result = new Date(
      new Date(today + "T00:00:00Z").getTime() + offset * 86400000,
    )
      .toISOString()
      .slice(0, 10);
  }
  if (!result) return null;
  if (
    !filterSchema.safeParse({ date: result }).success ||
    result < today ||
    result >
      new Date(new Date(today + "T00:00:00Z").getTime() + 31 * 86400000)
        .toISOString()
        .slice(0, 10)
  ) {
    throw new AppError(
      400,
      "ASSISTANT_INVALID_DATE",
      "Choose a valid date from today through the next 31 days, in India time.",
    );
  }
  return result;
}
export function matchesTime(
  start: Date,
  after: string | null,
  before: string | null,
) {
  const time = new Date(start.getTime() + 19800000).toISOString().slice(11, 16);
  return (!after || time >= after) && (!before || time < before);
}
