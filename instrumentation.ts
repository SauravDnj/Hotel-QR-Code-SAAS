import type { Instrumentation } from "next";

/**
 * Server error alerts. Sentry loads only when SENTRY_DSN is set, so local runs and tests
 * are unaffected. See lib/observability/sentry.ts for what is (and isn't) sent.
 */
export async function register() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  const [Sentry, { sentryOptions }] = await Promise.all([import("@sentry/nextjs"), import("@/lib/observability/sentry")]);
  Sentry.init(sentryOptions(dsn));
}

export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(...args);
};
