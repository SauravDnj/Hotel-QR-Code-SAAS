import { z } from "zod";

/** Money is stored as integer minor units (paise, cents) of an ISO currency. */

export function minorDigits(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

export function formatMoney(minor: number, currency: string, locale = "en-IN"): string {
  const digits = minorDigits(currency);
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: digits }).format(minor / 10 ** digits);
  } catch {
    return `${(minor / 10 ** digits).toFixed(digits)} ${currency}`;
  }
}

/** Major-unit text typed by staff ("250", "250.5", "-40") → minor units; rejects extra precision. */
export function moneySchema(currency: string, opts: { allowNegative?: boolean; max?: number } = {}) {
  const digits = minorDigits(currency);
  const pattern = new RegExp(`^${opts.allowNegative ? "-?" : ""}\\d{1,9}(\\.\\d{1,${Math.max(digits, 1)}})?$`);
  return z
    .string()
    .trim()
    .regex(pattern, digits ? `Enter an amount like 250 or 250.50` : "Enter a whole amount")
    .transform((v) => {
      const [whole, frac = ""] = v.replace("-", "").split(".");
      const minor = Number(whole) * 10 ** digits + Number((frac + "0".repeat(digits)).slice(0, digits) || 0);
      return v.startsWith("-") ? -minor : minor;
    })
    .refine((m) => Math.abs(m) <= (opts.max ?? 100_000_000), "Amount is too large");
}

/** Minor units → the major-unit string used to prefill forms. */
export function toMajorString(minor: number, currency: string): string {
  const digits = minorDigits(currency);
  return (minor / 10 ** digits).toFixed(digits);
}
