export const timezone = import.meta.env.VITE_APP_TIMEZONE || "Asia/Kolkata";
export const money = (amount: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount / 100);
export const dateLabel = (value: string) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(value));
export const timeLabel = (value: string) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
export const localDay = (value: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
export const wasteLabel = (value: string) =>
  ({
    PLASTIC: "Plastic",
    FOOD: "Food waste",
    GREEN_WASTE: "Garden waste",
    PAPER: "Paper",
    ELECTRONIC: "E-waste",
    GENERAL: "General waste",
  })[value] ?? value;
