/**
 * Browser error alerts. The Sentry SDK is only downloaded when NEXT_PUBLIC_SENTRY_DSN is set,
 * so guests and staff get no extra JavaScript otherwise.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Promise.all([import("@sentry/nextjs"), import("@/lib/observability/sentry")])
    .then(([Sentry, { sentryOptions }]) => Sentry.init(sentryOptions(dsn)))
    .catch(() => {
      // Monitoring must never break the app.
    });
}
