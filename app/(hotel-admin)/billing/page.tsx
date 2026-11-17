import type { Metadata } from "next";
import { ActionForm } from "@/components/action-form";
import { PermissionDenied } from "@/components/permission-denied";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card } from "@/components/ui/card";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { can } from "@/lib/permissions/authorize";
import { formatDateTime } from "@/lib/utils";
import { getBillingOverview } from "@/modules/billing/service";
import { GRACE_DAYS } from "@/modules/billing/subscription";
import { choosePlanAction } from "./actions";

export const metadata: Metadata = { title: "Billing" };

const money = (minor: number, currency: string) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(minor / 100);

const STATUS: Record<string, { label: string; tone: "info" | "success" | "warning" | "danger" }> = {
  trialing: { label: "Free trial", tone: "info" },
  active: { label: "Active", tone: "success" },
  past_due: { label: "Payment due", tone: "warning" },
  suspended: { label: "Suspended", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "danger" },
};

function Meter({ label, used, max }: { label: string; used: number; max: number }) {
  const full = used >= max;
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className={full ? "font-semibold text-danger" : "text-muted-foreground"}>
          {used} / {max}
        </span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-surface-muted" role="meter" aria-label={label} aria-valuenow={used} aria-valuemin={0} aria-valuemax={max}>
        <div className={full ? "h-2 rounded-full bg-danger" : "h-2 rounded-full bg-primary"} style={{ width: `${Math.min(100, max ? (used / max) * 100 : 100)}%` }} />
      </div>
    </div>
  );
}

export default async function BillingPage() {
  const ctx = await requireTenantContext();
  if (!can(ctx, "billing.view")) return <PermissionDenied />;
  const b = await getBillingOverview(getDb(), ctx);
  const s = b.subscription;
  const manage = can(ctx, "billing.manage");
  const st = STATUS[s.status];
  const e = b.plan.entitlements;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="text-sm text-muted-foreground">Your plan, usage and receipts. Payments are processed by Razorpay; we never see card details.</p>
      </div>

      {s.status === "past_due" && (
        <Alert tone="warning">
          Payment is due. Everything keeps working until {s.graceEndsAt ? formatDateTime(s.graceEndsAt, "UTC") : "the grace period ends"} (
          {GRACE_DAYS}-day grace period). After that the account becomes read-only until payment.
        </Alert>
      )}
      {(s.status === "suspended" || s.status === "cancelled") && (
        <Alert tone="danger">
          The account is read-only. Your data is safe and nothing is deleted. Choose a plan below to restore full access.
        </Alert>
      )}

      <Card className="grid gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{b.plan.name}</h2>
            <Badge tone={st.tone}>{st.label}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">{b.plan.description}</p>
          {s.status === "trialing" && s.trialEndsAt && <p className="text-sm">Trial ends {formatDateTime(s.trialEndsAt, "UTC")}.</p>}
          {s.status === "active" && s.currentPeriodEnd && <p className="text-sm">Renews {formatDateTime(s.currentPeriodEnd, "UTC")}.</p>}
          {b.pendingPlan && s.checkoutUrl && (
            <p className="text-sm">
              Checkout started for <strong>{b.pendingPlan.name}</strong>.{" "}
              <a href={s.checkoutUrl} className="text-primary underline underline-offset-4" rel="noreferrer">
                Continue to payment
              </a>
            </p>
          )}
        </div>
        <div className="space-y-3">
          <Meter label="Rooms" used={b.usage.rooms} max={e.maxRooms} />
          <Meter label="Properties" used={b.usage.properties} max={e.maxProperties} />
          <Meter label="Staff seats (incl. open invitations)" used={b.usage.staffSeats} max={e.maxStaffSeats} />
          <p className="text-xs text-muted-foreground">Reports: {e.modules.reports ? "included" : "not included"} · Integrations: {e.modules.integrations ? "included" : "not included"}</p>
        </div>
      </Card>

      <div>
        <h2 className="mb-3 text-sm font-semibold">Plans</h2>
        {!b.paymentsEnabled && (
          <Alert tone="info" className="mb-3">
            Online payment is not switched on yet. Contact support to change plans.
          </Alert>
        )}
        <ul className="grid gap-3 md:grid-cols-3" aria-label="Plans">
          {b.plans.map((p) => {
            const current = p.id === b.plan.id;
            return (
              <li key={p.id}>
                <Card className="flex h-full flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">{p.name}</h3>
                    {current && <Badge tone="success">Current</Badge>}
                  </div>
                  <p className="text-2xl font-semibold">
                    {money(p.priceMinor, p.currency)}
                    <span className="text-sm font-normal text-muted-foreground"> / month</span>
                  </p>
                  <ul className="text-sm text-muted-foreground">
                    <li>Up to {p.entitlements.maxRooms} rooms</li>
                    <li>Up to {p.entitlements.maxProperties} propert{p.entitlements.maxProperties === 1 ? "y" : "ies"}</li>
                    <li>Up to {p.entitlements.maxStaffSeats} staff</li>
                    <li>{p.entitlements.modules.reports ? "Reports included" : "No reports"}</li>
                    <li>{p.entitlements.modules.integrations ? "API & integrations" : "No API access"}</li>
                  </ul>
                  {manage && b.paymentsEnabled && p.razorpayPlanId && !(current && s.status === "active") && (
                    <ActionForm action={choosePlanAction.bind(null, p.id)} className="mt-auto pt-2">
                      <Button type="submit" className="w-full">
                        {current ? "Pay for this plan" : `Choose ${p.name}`}
                      </Button>
                    </ActionForm>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      </div>

      <Card className="overflow-x-auto p-0">
        <h2 className="px-4 pt-4 text-sm font-semibold">Receipts</h2>
        {b.receipts.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No payments yet.</p>
        ) : (
          <table className="mt-2 w-full text-left text-sm" aria-label="Receipts">
            <thead className="border-b border-border text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Amount</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Payment reference</th>
              </tr>
            </thead>
            <tbody>
              {b.receipts.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2">{r.paidAt ? formatDateTime(r.paidAt, "UTC") : "—"}</td>
                  <td className="px-4 py-2">{money(r.amountMinor, r.currency)}</td>
                  <td className="px-4 py-2 capitalize">{r.status}</td>
                  <td className="px-4 py-2 font-mono text-xs">{r.providerPaymentId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
