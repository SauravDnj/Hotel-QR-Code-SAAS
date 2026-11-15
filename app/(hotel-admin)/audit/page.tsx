import type { Metadata } from "next";
import { PermissionDenied } from "@/components/permission-denied";
import { EmptyState, PageHeader } from "@/components/ui/card";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { can } from "@/lib/permissions/authorize";
import { formatDateTime } from "@/lib/utils";
import { listTenantAuditLogs } from "@/modules/audit/service";
import { getTenantSettings } from "@/modules/tenants/settings";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage() {
  const ctx = await requireTenantContext();
  if (!can(ctx, "audit.view")) return <PermissionDenied />;
  const [rows, tenant] = await Promise.all([
    listTenantAuditLogs(getDb(), ctx, { limit: 100 }),
    getTenantSettings(getDb(), ctx),
  ]);

  return (
    <>
      <PageHeader title="Audit log" description={`Latest 100 events. Times shown in ${tenant.timezone}.`} />
      {rows.length === 0 ? (
        <EmptyState title="No events yet" description="Security and configuration changes will appear here." />
      ) : (
        <div className="overflow-x-auto rounded-ui border border-border bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-surface-muted text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">When</th>
                <th scope="col" className="px-4 py-3 font-medium">Actor</th>
                <th scope="col" className="px-4 py-3 font-medium">Action</th>
                <th scope="col" className="px-4 py-3 font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border align-top last:border-0">
                  <td className="whitespace-nowrap px-4 py-3">{formatDateTime(r.createdAt, tenant.timezone)}</td>
                  <td className="px-4 py-3">
                    {r.actorType === "platform_admin" ? "Platform support" : (r.actorName ?? r.actorType)}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{r.action}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {Object.keys(r.metadata).length ? JSON.stringify(r.metadata) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
