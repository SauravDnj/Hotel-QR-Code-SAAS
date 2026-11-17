import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, PageHeader } from "@/components/ui/card";
import { requirePlatformAdmin } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { formatDateTime } from "@/lib/utils";
import { platformOverview } from "@/modules/platform/admin";
import { platformMetrics } from "@/modules/platform/service";
import { Stat, StatusBadge } from "./ui";

export const metadata: Metadata = { title: "Super admin" };

export default async function PlatformOverviewPage() {
  const actor = await requirePlatformAdmin();
  const [o, metrics] = await Promise.all([platformOverview(getDb(), actor), platformMetrics(getDb(), actor)]);
  const mrr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(metrics.mrrMinor / 100);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Overview"
        description="All hotels on the platform. Times in UTC."
        actions={
          <Link href="/platform/tenants/new" className={buttonVariants()}>
            Add hotel
          </Link>
        }
      />

      <section aria-label="Platform totals" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Hotels" value={o.hotels} hint={`${o.properties} properties`} />
        <Stat label="Rooms" value={o.rooms} hint={`${o.inHouseStays} guests in house`} />
        <Stat label="Logins" value={o.users} hint={`${o.activeStaff} active staff seats · ${o.platformAdmins} super admin`} />
        <Stat label="MRR" value={mrr} hint="Active paid plans" />
        <Stat label="Requests (24 h)" value={o.requests24h} />
        <Stat label="Requests (30 days)" value={o.requests30d} />
        <Stat label="Open requests" value={o.openRequests} hint="All hotels" />
        <Stat label="Trials ending ≤ 7 days" value={o.trialsEnding.length} />
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <h2 className="mb-3 text-sm font-semibold">Hotels by status</h2>
          <ul className="space-y-2 text-sm">
            {metrics.byStatus.length === 0 && <li className="text-muted-foreground">No hotels yet.</li>}
            {metrics.byStatus.map((s) => (
              <li key={s.status} className="flex items-center justify-between">
                <Link href={`/platform/tenants?status=${s.status}`} className="underline-offset-4 hover:underline">
                  <StatusBadge status={s.status} />
                </Link>
                <span className="tabular-nums">{s.n}</span>
              </li>
            ))}
          </ul>
          <h2 className="mb-2 mt-5 text-sm font-semibold">Subscriptions by plan</h2>
          <ul className="space-y-1 text-sm">
            {metrics.byPlan.map((p) => (
              <li key={`${p.plan}-${p.status}`} className="flex justify-between">
                <span>
                  {p.plan} · <span className="text-muted-foreground">{p.status}</span>
                </span>
                <span className="tabular-nums">{p.n}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h2 className="mb-3 text-sm font-semibold">Trials ending soon</h2>
          {o.trialsEnding.length === 0 ? (
            <p className="text-sm text-muted-foreground">None in the next 7 days.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {o.trialsEnding.map((t) => (
                <li key={t.id} className="flex justify-between gap-2">
                  <Link href={`/platform/tenants/${t.id}`} className="truncate text-primary underline underline-offset-4">
                    {t.name}
                  </Link>
                  <span className="whitespace-nowrap text-muted-foreground">{t.trialEndsAt ? formatDateTime(t.trialEndsAt, "UTC") : "—"}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <h2 className="mb-3 text-sm font-semibold">Newest hotels</h2>
          {o.recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hotels yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {o.recent.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2">
                  <Link href={`/platform/tenants/${t.id}`} className="truncate text-primary underline underline-offset-4">
                    {t.name}
                  </Link>
                  <StatusBadge status={t.status} />
                </li>
              ))}
            </ul>
          )}
          <Link href="/platform/tenants" className="mt-4 inline-block text-sm text-primary underline underline-offset-4">
            All hotels →
          </Link>
        </Card>
      </div>
    </div>
  );
}
