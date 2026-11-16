import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Badge, EmptyState, PageHeader } from "@/components/ui/card";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { can, propertyScope } from "@/lib/permissions/authorize";
import { PermissionDenied } from "@/components/permission-denied";
import { listProperties } from "@/modules/properties/service";

export const metadata: Metadata = { title: "Properties" };

export default async function PropertiesPage() {
  const ctx = await requireTenantContext();
  const scope = propertyScope(ctx, "property.view");
  if (scope !== "all" && scope.length === 0) return <PermissionDenied />;
  // listProperties applies tenant + property scope in the query itself.
  const rows = await listProperties(getDb(), ctx);
  const canManage = can(ctx, "property.manage");

  return (
    <>
      <PageHeader
        title="Properties"
        description="Hotels and branches in this account."
        actions={
          canManage && (
            <Link href="/properties/new" className={buttonVariants()}>
              Add property
            </Link>
          )
        }
      />
      {rows.length === 0 ? (
        <EmptyState title="No properties" description="Add a property to start configuring rooms and services." />
      ) : (
        <div className="overflow-x-auto rounded-ui border border-border bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-surface-muted text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Name</th>
                <th scope="col" className="px-4 py-3 font-medium">City</th>
                <th scope="col" className="px-4 py-3 font-medium">Timezone</th>
                <th scope="col" className="px-4 py-3 font-medium">Currency</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/properties/${p.id}`} className="text-primary underline underline-offset-4">
                      {p.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{p.city ?? "—"}</td>
                  <td className="px-4 py-3">{p.timezone}</td>
                  <td className="px-4 py-3">{p.currency}</td>
                  <td className="px-4 py-3">
                    <Badge tone={p.status === "active" ? "success" : "warning"}>{p.status}</Badge>
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
