"use client";

import { useEffect } from "react";

/**
 * Last-resort error screen (replaces the root layout when it crashes). Reports the error to
 * Sentry when browser alerts are enabled; the message shown never includes error details.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
    import("@sentry/nextjs").then((Sentry) => Sentry.captureException(error)).catch(() => {});
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0, background: "#f6f5f2", color: "#1f2a44" }}>
        <main style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 22, marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ color: "#5b6475", marginBottom: 16 }}>Please try again. If it keeps happening, contact reception or your hotel administrator.</p>
          {error.digest && <p style={{ fontSize: 12, color: "#8a91a0", marginBottom: 16 }}>Reference: {error.digest}</p>}
          <button onClick={reset} style={{ padding: "10px 18px", borderRadius: 10, border: 0, background: "#1f2a44", color: "#fff", fontSize: 15, cursor: "pointer" }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
