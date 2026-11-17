import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";
import { redact } from "./logger";

/**
 * Error alerts (Sentry). Off unless SENTRY_DSN (server) / NEXT_PUBLIC_SENTRY_DSN (browser) is
 * set. Privacy first (SECURITY_PRIVACY.md): no default PII, no cookies, headers or request
 * bodies, no query strings, and the secret part of guest/invite/reset links is masked, so a
 * report can never be used to open a room page, a request receipt or an account.
 */

/** /r/<qr token>, /s/<status token>, /invite/<token>, /reset-password/<token> → [token]. */
const SECRET_PATH = /\/(r|s|invite|reset-password)\/[^/?#\s]+/g;

export function scrubUrl(url: string): string {
  return url.replace(SECRET_PATH, "/$1/[token]").replace(/\?[^#\s]*/g, "");
}

function scrubText(v: unknown): unknown {
  return typeof v === "string" ? scrubUrl(v) : v;
}

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    event.request = {
      method: event.request.method,
      url: event.request.url ? scrubUrl(event.request.url) : undefined,
      headers: event.request.headers?.["user-agent"] ? { "user-agent": event.request.headers["user-agent"] } : undefined,
    };
  }
  delete event.user;
  if (event.transaction) event.transaction = scrubUrl(event.transaction);
  if (event.extra) event.extra = redact(event.extra) as Record<string, unknown>;
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
  for (const ex of event.exception?.values ?? []) if (ex.value) ex.value = scrubUrl(ex.value);
  if (event.message) event.message = scrubUrl(event.message);
  return event;
}

export function scrubBreadcrumb(b: Breadcrumb): Breadcrumb {
  if (b.message) b.message = scrubUrl(b.message);
  if (b.data) {
    for (const k of ["url", "from", "to"]) if (k in b.data) b.data[k] = scrubText(b.data[k]);
    b.data = redact(b.data) as Record<string, unknown>;
  }
  return b;
}

export function sentryOptions(dsn: string) {
  return {
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA,
    // Errors only: no performance tracing, no session replay (keeps it free-tier friendly and private).
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  };
}
