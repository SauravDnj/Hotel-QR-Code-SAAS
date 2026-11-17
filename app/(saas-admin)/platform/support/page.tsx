import type { Metadata } from "next";
import { Badge, Card, PageHeader } from "@/components/ui/card";
import { requirePlatformAdmin } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { opsHealth } from "@/modules/platform/ops";
import { resetLinkAction, resetMfaAction } from "./actions";
import { RecoveryForm } from "./recovery-form";

export const metadata: Metadata = { title: "Support & operations" };

function Row({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <div className="flex justify-between border-b border-border py-1.5 text-sm last:border-0">
      <span>{label}</span>
      <span className={warn ? "font-semibold text-danger" : "tabular-nums"}>{value}</span>
    </div>
  );
}

/** Daily operations checks + account recovery (OPERATIONS_RUNBOOK.md). Everything here is audited. */
export default async function SupportPage() {
  const actor = await requirePlatformAdmin();
  const h = await opsHealth(getDb(), actor);
  const failedWebhooks = h.webhooks.find((w) => w.status === "failed")?.n ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Support & operations" description="Daily health checks and account recovery. See docs/RUNBOOK.md for procedures." />

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <h2 className="mb-2 text-sm font-semibold">Realtime outbox</h2>
          <Row label="Pending" value={h.outbox.pending ?? 0} />
          <Row label="Retrying" value={h.outbox.retrying ?? 0} warn={(h.outbox.retrying ?? 0) > 0} />
          <Row label="Dead (gave up)" value={h.outbox.dead ?? 0} warn={(h.outbox.dead ?? 0) > 0} />
          <Row label="Oldest pending" value={h.outbox.oldestPendingMinutes === null ? "—" : `${h.outbox.oldestPendingMinutes} min`} warn={(h.outbox.oldestPendingMinutes ?? 0) > 30} />
        </Card>
        <Card>
          <h2 className="mb-2 text-sm font-semibold">Guest requests (all hotels)</h2>
          <Row label="Last 24 h" value={h.requests?.last24h ?? 0} />
          <Row label="Open past target" value={h.requests?.openOverdue ?? 0} warn={(h.requests?.openOverdue ?? 0) > 0} />
          <Row label="New, unassigned" value={h.requests?.unassignedNew ?? 0} />
          <Row label="Escalated" value={h.requests?.escalated ?? 0} warn={(h.requests?.escalated ?? 0) > 0} />
        </Card>
        <Card>
          <h2 className="mb-2 text-sm font-semibold">Billing</h2>
          {h.subscriptions.map((s) => (
            <Row key={s.status} label={s.status} value={s.n} warn={s.status === "past_due" || s.status === "suspended"} />
          ))}
          <Row label="Payment webhooks failed (7 d)" value={failedWebhooks} warn={failedWebhooks > 0} />
          <Row label="Rate-limit rows" value={h.rateLimitRows} />
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="mb-1 text-sm font-semibold">Forgotten password</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Verify the person out of band first (e.g. call the hotel&apos;s known number). Creates a one-time link valid for 1 hour.
          </p>
          <RecoveryForm action={resetLinkAction} label="Password reset" submit="Create reset link" />
        </Card>
        <Card>
          <h2 className="mb-1 text-sm font-semibold">Lost authenticator</h2>
          <p className="mb-3 text-xs text-muted-foreground">Turns off two-step sign-in so they can set it up again. Signs them out everywhere.</p>
          <RecoveryForm action={resetMfaAction} label="Reset two-step sign-in" submit="Reset two-step sign-in" />
        </Card>
      </div>
      <p className="text-xs text-muted-foreground">
        <Badge>Never</Badge> ask for passwords, payment secrets, QR links or guest ID documents over chat or email.
      </p>
    </div>
  );
}
