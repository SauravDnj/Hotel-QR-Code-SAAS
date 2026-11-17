/**
 * Node/ICU lists some zones under legacy names (e.g. "Asia/Calcutta"). Show and store
 * the current IANA names instead, and validate by asking Intl whether it accepts the zone.
 */
const MODERN_NAMES: Record<string, string> = {
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Europe/Kiev": "Europe/Kyiv",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "America/Godthab": "America/Nuuk",
  "Pacific/Truk": "Pacific/Chuuk",
  "Pacific/Ponape": "Pacific/Pohnpei",
};

export const TIMEZONES: string[] = [
  ...new Set(["UTC", ...Intl.supportedValuesOf("timeZone").map((tz) => MODERN_NAMES[tz] ?? tz)]),
].sort();

export function isValidTimezone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Offset (ms) of a timezone at a given instant: local wall time minus UTC. */
function tzOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * Converts a wall-clock date + time in a property's timezone (as typed by reception, e.g.
 * "2026-11-20" "11:00") to the UTC instant. Handles DST by re-checking the offset.
 */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let utc = wall - tzOffsetMs(new Date(wall), timeZone);
  utc = wall - tzOffsetMs(new Date(utc), timeZone);
  return new Date(utc);
}

/** "YYYY-MM-DD" of an instant in a timezone. */
export function localDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

/** Tomorrow's local calendar date in a timezone (default for checkout). */
export function tomorrowIn(timeZone: string, now: Date = new Date()): string {
  return localDate(new Date(now.getTime() + 86400_000), timeZone);
}

/** Calendar arithmetic on "YYYY-MM-DD" strings (no timezone involved). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Nights of a stay: every date in [from, to). */
export function eachNight(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d < to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

export const isoDateSchemaPattern = /^\d{4}-\d{2}-\d{2}$/;
