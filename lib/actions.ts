import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { errorFields, logger } from "@/lib/observability/logger";

export interface ActionState {
  ok?: boolean;
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  /** Echo of submitted values so forms keep input after a failed submit (never passwords). */
  values?: Record<string, string>;
}

/** Plain-object view of FormData, excluding password fields. */
export function formValues(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    if (typeof v === "string" && !/password/i.test(k) && !k.startsWith("$")) out[k] = v;
  }
  return out;
}

/** Converts known errors into form-friendly state; unknown errors are logged and hidden. */
export function toActionState(err: unknown, values?: Record<string, string>): ActionState {
  if (err instanceof z.ZodError) {
    return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: z.flattenError(err).fieldErrors, values };
  }
  if (err instanceof AppError) return { ok: false, message: err.message, values };
  logger.error("action_failed", errorFields(err));
  return { ok: false, message: "Something went wrong. Please try again.", values };
}
