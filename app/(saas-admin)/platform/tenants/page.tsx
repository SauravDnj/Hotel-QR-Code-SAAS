import type { Metadata } from "next";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/card";
import { requirePlatformAdmin } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { formatDateTime } from "@/lib/utils";
import { searchTenants } from "@/modules/platform/admin";
import { StatusBadge, td, th } from "../ui";

export const metadata: Metadata = { title: "Hotels" };

const STATUSES = ["trialing", "active", "past_due", "suspended", "cancelled"] as const;

export default async function TenantsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const actor = await requirePlatformAdmin();
  const sp = await searchParams;
  const rows = await searchTenants(getDb(), actor, { q: sp.q, status: sp.status as never });

  return (
    <div>
      <PageHeader
        title="Hotels"
        description={`${rows.length} hotel account${rows.length === 1 ? "" : "s"}${sp.q || sp.status ? " matching your filter" : ""}. Open one to manage its staff, plan and status.`}
        actions={
          <Link href="/platform/tenants/new" className={buttonVariants()}>
            Add hotel
          </Link>
        }
      />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2" role="search" aria-label="Filter hotels">
        <label className="flex flex-col gap-1 text-xs">
          Search
          <input
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="Name, email or slug"
            className="min-h-10 w-64 rounded-ui border border-border bg-surface px-3 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Status
          <select name="status" defaultValue={sp.status ?? ""} className="min-h-10 rounded-ui border border-border bg-surface px-3 text-sm">
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
        {(sp.q || sp.status) && (
          <Link href="/platform/tenants" className="text-sm text-primary underline underline-offset-4">
            Clear
          </Link>
        )}
      </form>

      {rows.length === 0 ? (
        <EmptyState title="No hotels found" description="Hotels appear here after they sign up or you add them." />
      ) : (
        <div className="overflow-x-auto rounded-ui border border-border bg-surface">
          <table className="w-full text-left text-sm" aria-label="Hotels">
            <thead className="border-b border-border bg-surface-muted text-muted-foreground">
              <tr>
                <th scope="col" className={th}>Hotel</th>
                <th scope="col" className={th}>Status</th>
                <th scope="col" className={th}>Plan</th>
                <th scope="col" className={th}>Rooms</th>
                <th scope="col" className={th}>Staff</th>
                <th scope="col" className={th}>Created</th>
                <th scope="col" className={th}><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="border-b border-border last:border-0">
                  <td className={td}>
                    <Link href={`/platform/tenants/${t.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
                      {t.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {t.contactEmail} · {t.country}
                    </p>
                  </td>
                  <td className={td}>
                    <StatusBadge status={t.status} />
                    {t.platformHold && <p className="mt-1 text-xs text-danger">Suspended by super admin</p>}
                  </td>
                  <td className={td}>
                    <p>{t.planName ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.subscriptionStatus ?? "no subscription"}
                      {t.subscriptionStatus === "trialing" && t.trialEndsAt && <> · until {formatDateTime(t.trialEndsAt, "UTC")}</>}
                    </p>
                  </td>
                  <td className={`${td} tabular-nums`}>{t.rooms}</td>
                  <td className={`${td} tabular-nums`}>{t.staff}</td>
                  <td className={`${td} whitespace-nowrap`}>{formatDateTime(t.createdAt, "UTC")}</td>
                  <td className={td}>
                    <Link href={`/platform/tenants/${t.id}`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
                      Manage
                    </Link>
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
