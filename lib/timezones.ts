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
