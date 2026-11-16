import type { Metadata } from "next";
import Link from "next/link";
import { logoutAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, PageHeader } from "@/components/ui/card";
import { requirePlatformAdmin } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { formatDateTime } from "@/lib/utils";
import { listTenantsForPlatform, platformMetrics } from "@/modules/platform/service";
import { ActionForm } from "@/components/action-form";
import { Input } from "@/components/ui/form";
import { extendTrialAction } from "./actions";
import { TenantStatusForm } from "./tenant-status-form";

export const metadata: Metadata = { title: "Platform console" };

const tone = (s: string) => (s === "suspended" || s === "cancelled" ? "danger" : s === "past_due" ? "warning" : "success");

export default async function PlatformPage() {
  const actor = await requirePlatformAdmin();
  const [tenants, metrics] = await Promise.all([listTenantsForPlatform(getDb(), actor), platformMetrics(getDb(), actor)]);
  const mrr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(metrics.mrrMinor / 100);

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      <div className="mb-2 flex items-center justify-between gap-3 text-sm">
        <span className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
          SaaS operator · all actions are audited
        </span>
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-primary underline underline-offset-4">
            My hotel workspace
          </Link>
          <form action={logoutAction}>
            <Button variant="secondary" size="sm" type="submit">
              Sign out
            </Button>
          </form>
        </div>
      </div>
      <PageHeader title="Tenants" description={`${tenants.length} hotel accounts. Times in UTC.`} />
      <div className="mb-6 flex flex-wrap items-center gap-2 text-sm">
        {metrics.byStatus.map((s) => (
          <Badge key={s.status} tone={tone(s.status)}>
            {s.status}: {s.n}
          </Badge>
        ))}
        <span className="ml-2 font-medium">MRR (active paid plans): {mrr}</span>
        <Link href="/platform/plans" className="ml-auto text-primary underline underline-offset-4">
          Plans & limits →
        </Link>
        <Link href="/platform/support" className="text-primary underline underline-offset-4">
          Support & operations →
        </Link>
      </div>
      {tenants.length === 0 ? (
        <EmptyState title="No tenants yet" description="Hotels appear here after they sign up." />
      ) : (
        <div className="overflow-x-auto rounded-ui border border-border bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-surface-muted text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Hotel</th>
                <th scope="col" className="px-4 py-3 font-medium">Owner</th>
                <th scope="col" className="px-4 py-3 font-medium">Properties</th>
                <th scope="col" className="px-4 py-3 font-medium">Created</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
                <th scope="col" className="px-4 py-3 font-medium">Plan</th>
                <th scope="col" className="px-4 py-3 font-medium">Change status</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id} className="border-b border-border align-top last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium">{t.name}</p>
                    <p className="text-xs text-muted-foreground">{t.slug} · {t.country}</p>
                  </td>
                  <td className="px-4 py-3">{t.ownerEmail ?? "—"}</td>
                  <td className="px-4 py-3">{t.propertyCount}</td>
                  <td className="whitespace-nowrap px-4 py-3">{formatDateTime(t.createdAt, "UTC")}</td>
                  <td className="px-4 py-3">
                    <Badge tone={tone(t.status)}>{t.status}</Badge>
                    {t.platformHold && <p className="mt-1 text-xs text-danger">Platform hold</p>}
                  </td>
                  <td className="px-4 py-3">
                    <p>{t.planName ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.subscriptionStatus ?? "no subscription"}
                      {t.subscriptionStatus === "trialing" && t.trialEndsAt && <> · until {formatDateTime(t.trialEndsAt, "UTC")}</>}
                    </p>
                    {t.subscriptionStatus !== "active" && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-primary">Extend trial</summary>
                        <ActionForm action={extendTrialAction.bind(null, t.id)} className="mt-1 flex flex-col gap-1" aria-label={`Extend trial for ${t.name}`}>
                          <Input name="days" type="number" min={1} max={90} defaultValue={14} aria-label="Days" className="w-24" />
                          <Input name="reason" placeholder="Reason" aria-label="Reason" className="w-40" />
                          <Button type="submit" size="sm" variant="secondary">
                            Extend
                          </Button>
                        </ActionForm>
                      </details>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <TenantStatusForm tenantId={t.id} suspended={t.platformHold} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
