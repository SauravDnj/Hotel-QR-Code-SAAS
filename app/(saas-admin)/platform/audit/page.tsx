import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/card";
import { requirePlatformAdmin } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { formatDateTime } from "@/lib/utils";
import { listPlatformAudit } from "@/modules/platform/admin";
import { td, th } from "../ui";

export const metadata: Metadata = { title: "Audit log" };

export default async function PlatformAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string; q?: string; mine?: string; before?: string }>;
}) {
  const actor = await requirePlatformAdmin();
  const sp = await searchParams;
  const tenantId = z.uuid().safeParse(sp.tenant).success ? sp.tenant : undefined;
  const before = sp.before && !Number.isNaN(Date.parse(sp.before)) ? new Date(sp.before) : undefined;
  const rows = await listPlatformAudit(getDb(), actor, {
    tenantId,
    q: sp.q?.slice(0, 100) || undefined,
    platformOnly: sp.mine === "1",
    before,
    limit: 100,
  });
  const next = rows.length === 100 ? rows[rows.length - 1].createdAt.toISOString() : null;
  const keep = new URLSearchParams(Object.entries({ tenant: tenantId ?? "", q: sp.q ?? "", mine: sp.mine ?? "" }).filter(([, v]) => v));

  return (
    <div>
      <PageHeader title="Audit log" description="Every hotel's security and admin events, newest first. Times in UTC." />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2" role="search" aria-label="Filter audit log">
        {tenantId && <input type="hidden" name="tenant" value={tenantId} />}
        <label className="flex flex-col gap-1 text-xs">
          Action contains
          <input name="q" defaultValue={sp.q ?? ""} placeholder="e.g. staff, platform, login" className="min-h-10 w-56 rounded-ui border border-border bg-surface px-3 text-sm" />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="mine" value="1" defaultChecked={sp.mine === "1"} />
          Super admin actions only
        </label>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
        {(tenantId || sp.q || sp.mine) && (
          <Link href="/platform/audit" className="text-sm text-primary underline underline-offset-4">
            Show all hotels
          </Link>
        )}
      </form>

      {rows.length === 0 ? (
        <EmptyState title="No events" description="Nothing matches this filter." />
      ) : (
        <div className="overflow-x-auto rounded-ui border border-border bg-surface">
          <table className="w-full text-left text-sm" aria-label="Audit events">
            <thead className="border-b border-border bg-surface-muted text-muted-foreground">
              <tr>
                <th scope="col" className={th}>When</th>
                <th scope="col" className={th}>Hotel</th>
                <th scope="col" className={th}>Action</th>
                <th scope="col" className={th}>By</th>
                <th scope="col" className={th}>Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-b border-border last:border-0">
                  <td className={`${td} whitespace-nowrap`}>{formatDateTime(a.createdAt, "UTC")}</td>
                  <td className={td}>
                    {a.tenantId ? (
                      <Link href={`/platform/tenants/${a.tenantId}`} className="text-primary underline-offset-4 hover:underline">
                        {a.tenantName}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">platform</span>
                    )}
                  </td>
                  <td className={td}>
                    <code className="text-xs">{a.action}</code>
                  </td>
                  <td className={td}>
                    {a.actorType === "platform_admin" ? "Super admin " : ""}
                    {a.actorEmail ?? a.actorType}
                  </td>
                  <td className={`${td} max-w-xs truncate text-xs text-muted-foreground`} title={JSON.stringify(a.metadata)}>
                    {Object.keys(a.metadata ?? {}).length ? JSON.stringify(a.metadata) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {next && (
        <Link
          href={`/platform/audit?${new URLSearchParams([...keep, ["before", next]]).toString()}`}
          className="mt-4 inline-block text-sm text-primary underline underline-offset-4"
        >
          Older events →
        </Link>
      )}
    </div>
  );
}
