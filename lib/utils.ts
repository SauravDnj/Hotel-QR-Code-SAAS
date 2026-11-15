import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Render a UTC timestamp in the property/tenant timezone. */
export function formatDateTime(date: Date | string, timeZone: string, locale = "en-IN") {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone }).format(
    typeof date === "string" ? new Date(date) : date,
  );
}
