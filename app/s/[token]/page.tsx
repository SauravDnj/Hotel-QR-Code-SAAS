import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Check } from "lucide-react";
import { clientIp } from "@/lib/auth/ip";
import { getDb } from "@/lib/db/client";
import { formatDateTime } from "@/lib/utils";
import { getGuestRequestStatus } from "@/modules/requests/guest";
import { RememberRequest } from "../../r/my-requests";
import { GuestShell } from "../../r/guest-shell";
import { AutoRefresh } from "./auto-refresh";

export const metadata: Metadata = {
  title: { absolute: "Your request" },
  robots: { index: false, follow: false },
  referrer: "same-origin",
};

const STEPS = ["Request sent", "Hotel team notified", "Being handled", "Completed"];

/**
 * Guest receipt for ONE request, reached only through its random status token. Shows
 * guest-safe fields (REQUEST_STATE_MACHINE.md "Guest-visible status mapping") and refreshes
 * itself while the request is open.
 */
export default async function GuestStatusPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const res = await getGuestRequestStatus(getDb(), token, { ip: clientIp(await headers()) });
  if (res.kind === "unavailable") notFound();
  if (res.kind === "rate_limited") {
    return (
      <GuestShell>
        <p className="mt-16 rounded-2xl bg-surface p-6 text-center shadow-sm" role="alert">
          Please wait a moment and refresh.
        </p>
      </GuestShell>
    );
  }
  const r = res.request;
  const accent = r.accentColor ?? "#1f2a44";
  const closed = r.status === "completed" || r.status === "cancelled";

  return (
    <GuestShell>
      <RememberRequest token={token} service={r.serviceName} at={r.submittedAt.toISOString()} />
      {!closed && <AutoRefresh seconds={10} />}
      <div className="rounded-2xl bg-surface p-5 shadow-sm">
        <p className="text-sm text-muted-foreground">
          {r.hotelName}
          {r.roomLabel && <> · Room {r.roomLabel}</>}
        </p>
        <h1 className="mt-1 text-xl font-semibold">{r.serviceName}</h1>
        <p className="mt-3 text-2xl font-semibold" style={{ color: r.status === "cancelled" ? undefined : accent }} role="status" aria-live="polite">
          {r.statusLabel}
        </p>
        {r.status === "new" && r.ackMessage && <p className="mt-1 text-sm text-muted-foreground">{r.ackMessage}</p>}
        {r.guestMessage && (
          <p className="mt-3 rounded-xl bg-surface-muted p-3 text-sm">
            <span className="font-medium">Message from the hotel:</span> {r.guestMessage}
          </p>
        )}

        {r.status !== "cancelled" && (
          <ol className="mt-5 space-y-3" aria-label="Progress">
            {STEPS.map((label, i) => {
              const done = r.step > i;
              const at = r.timeline.find((t) => t.label === label)?.at;
              return (
                <li key={label} className="flex items-center gap-3">
                  <span
                    className="flex size-7 shrink-0 items-center justify-center rounded-full border-2"
                    style={done ? { background: accent, borderColor: accent, color: "#fff" } : undefined}
                    aria-hidden
                  >
                    {done && <Check className="size-4" />}
                  </span>
                  <span className={done ? "font-medium" : "text-muted-foreground"}>
                    {label}
                    {done && at && <span className="block text-xs font-normal text-muted-foreground">{formatDateTime(at, r.timezone)}</span>}
                  </span>
                  <span className="sr-only">{done ? "(done)" : "(pending)"}</span>
                </li>
              );
            })}
          </ol>
        )}

        <dl className="mt-5 space-y-1 border-t border-border pt-4 text-sm">
          {r.quantity !== null && (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Quantity</dt>
              <dd>{r.quantity}</dd>
            </div>
          )}
          {r.option && (
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Choice</dt>
              <dd>{r.option}</dd>
            </div>
          )}
          {r.note && (
            <div>
              <dt className="text-muted-foreground">Your note</dt>
              <dd className="whitespace-pre-line">{r.note}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Sent</dt>
            <dd>{formatDateTime(r.submittedAt, r.timezone)}</dd>
          </div>
        </dl>
      </div>
      <p className="px-1 text-center text-xs text-muted-foreground">
        {closed ? "This request is closed." : "This page updates automatically."} Keep this link to check again later (valid
        for 3 days). Use your browser&apos;s back button to return to the room page.
      </p>
    </GuestShell>
  );
}
