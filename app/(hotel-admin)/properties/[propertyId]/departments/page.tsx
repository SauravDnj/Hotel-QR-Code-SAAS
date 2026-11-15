import type { Metadata } from "next";
import { ActionForm } from "@/components/action-form";
import { PermissionDenied } from "@/components/permission-denied";
import { Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { can, canWrite } from "@/lib/permissions/authorize";
import { listDepartments } from "@/modules/departments/service";
import { createDefaultDepartmentsAction, createDepartmentAction, updateDepartmentAction } from "../structure-actions";

export const metadata: Metadata = { title: "Departments" };

export default async function DepartmentsPage({ params }: { params: Promise<{ propertyId: string }> }) {
  const { propertyId } = await params;
  const ctx = await requireTenantContext();
  if (!can(ctx, "property.view", { propertyId })) return <PermissionDenied />;
  const rows = await listDepartments(getDb(), ctx, propertyId);
  const manage = canWrite(ctx, "property.manage", { propertyId });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Departments</h2>
        <p className="text-sm text-muted-foreground">
          Guest requests are routed to these teams (water → Room Service, cleaning → Housekeeping). Staff are assigned to
          departments in a later release.
        </p>
      </div>

      {manage && (
        <Card className="flex flex-wrap items-end justify-between gap-4">
          <ActionForm action={createDepartmentAction.bind(null, propertyId)} className="flex flex-wrap items-end gap-3" aria-label="Add department">
            <label className="flex flex-col gap-1 text-sm">
              New department
              <Input name="name" placeholder="e.g. Spa, Concierge" required className="w-56" />
            </label>
            <Button type="submit">Add</Button>
          </ActionForm>
          <ActionForm action={createDefaultDepartmentsAction.bind(null, propertyId)}>
            <Button type="submit" variant="secondary">
              Add standard departments
            </Button>
          </ActionForm>
        </Card>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title="No departments yet"
          description="Add the standard set (Reception, Housekeeping, Room Service, Maintenance, Security) or your own."
        />
      ) : (
        <div className="divide-y divide-border rounded-ui border border-border bg-surface">
          {rows.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              {manage ? (
                <ActionForm
                  action={updateDepartmentAction.bind(null, propertyId, d.id)}
                  className="flex flex-wrap items-center gap-2"
                  aria-label={`Edit ${d.name}`}
                >
                  <Input name="name" defaultValue={d.name} aria-label="Department name" className="w-56" required />
                  <Select name="status" defaultValue={d.status} aria-label="Status" className="w-32">
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </Select>
                  <Button type="submit" variant="secondary" size="sm">
                    Save
                  </Button>
                </ActionForm>
              ) : (
                <p className="font-medium">{d.name}</p>
              )}
              <span className="flex items-center gap-2">
                <code className="text-xs text-muted-foreground">{d.key}</code>
                <Badge tone={d.status === "active" ? "success" : "warning"}>{d.status}</Badge>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
