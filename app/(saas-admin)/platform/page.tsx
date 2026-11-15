import type { Metadata } from "next";
import Link from "next/link";
import { logoutAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, PageHeader } from "@/components/ui/card";
import { requirePlatformAdmin } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { formatDateTime } from "@/lib/utils";
import { listTenantsForPlatform } from "@/modules/platform/service";
import { TenantStatusForm } from "./tenant-status-form";

export const metadata: Metadata = { title: "Platform console" };

const tone = (s: string) => (s === "suspended" || s === "cancelled" ? "danger" : s === "past_due" ? "warning" : "success");

export default async function PlatformPage() {
  const actor = await requirePlatformAdmin();
  const tenants = await listTenantsForPlatform(getDb(), actor);

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      <div className="mb-2 flex items-center justify-between gap-3 text-sm">
        <span className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
          SaaS operator · all actions are audited
        </span>
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-primary underline-offset-4 hover:underline">
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
                  </td>
                  <td className="px-4 py-3">
                    <TenantStatusForm tenantId={t.id} suspended={t.status === "suspended"} />
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
