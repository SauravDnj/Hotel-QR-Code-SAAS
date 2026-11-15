import { z } from "zod";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password";
import { isValidTimezone } from "@/lib/timezones";

const CURRENCIES = new Set(Intl.supportedValuesOf("currency"));

export const timezoneSchema = z
  .string()
  .refine(isValidTimezone, "Choose a valid timezone");

export const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine((c) => CURRENCIES.has(c), "Choose a valid ISO currency code");

export const countrySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, "Use a 2-letter ISO country code (e.g. IN)");

export const nameSchema = (label: string, max = 120) =>
  z.string().trim().min(1, `${label} is required`).max(max, `${label} is too long`);

export const optionalText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

export const emailSchema = z.email("Enter a valid email address").max(254).transform((e) => e.trim().toLowerCase());

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(200, "Password is too long");

export const uuidSchema = z.uuid();
