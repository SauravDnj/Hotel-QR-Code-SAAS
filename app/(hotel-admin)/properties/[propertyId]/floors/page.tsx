import type { Metadata } from "next";
import { ActionForm, ConfirmButton } from "@/components/action-form";
import { PermissionDenied } from "@/components/permission-denied";
import { Button } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { can, canWrite } from "@/lib/permissions/authorize";
import { listFloors } from "@/modules/rooms/floors";
import { archiveFloorAction, createFloorAction, updateFloorAction } from "../structure-actions";

export const metadata: Metadata = { title: "Floors" };

export default async function FloorsPage({ params }: { params: Promise<{ propertyId: string }> }) {
  const { propertyId } = await params;
  const ctx = await requireTenantContext();
  if (!can(ctx, "room.view", { propertyId })) return <PermissionDenied />;
  const rows = await listFloors(getDb(), ctx, propertyId, { includeArchived: true });
  const manage = canWrite(ctx, "room.manage", { propertyId });
  const live = rows.filter((r) => !r.archivedAt);
  const archived = rows.filter((r) => r.archivedAt);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Floors</h2>
        <p className="text-sm text-muted-foreground">Order controls how floors appear in room lists and QR print sheets.</p>
      </div>

      {manage && (
        <Card>
          <h3 className="mb-3 text-sm font-semibold">Add floor</h3>
          <ActionForm action={createFloorAction.bind(null, propertyId)} className="flex flex-wrap items-end gap-3" aria-label="Add floor">
            <label className="flex flex-col gap-1 text-sm">
              Name
              <Input name="name" placeholder="e.g. Ground floor, Floor 1" required className="w-56" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Order
              <Input name="sortOrder" type="number" defaultValue={live.length} className="w-24" />
            </label>
            <Button type="submit">Add floor</Button>
          </ActionForm>
        </Card>
      )}

      {live.length === 0 ? (
        <EmptyState title="No floors yet" description="Add the floors of this property, then create rooms on them." />
      ) : (
        <div className="divide-y divide-border rounded-ui border border-border bg-surface">
          {live.map((f) => (
            <div key={f.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              {manage ? (
                <ActionForm
                  action={updateFloorAction.bind(null, propertyId, f.id)}
                  className="flex flex-wrap items-center gap-2"
                  aria-label={`Edit ${f.name}`}
                >
                  <Input name="name" defaultValue={f.name} aria-label="Floor name" className="w-56" required />
                  <Input name="sortOrder" type="number" defaultValue={f.sortOrder} aria-label="Order" className="w-20" />
                  <Button type="submit" variant="secondary" size="sm">
                    Save
                  </Button>
                </ActionForm>
              ) : (
                <p className="font-medium">{f.name}</p>
              )}
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">{f.roomCount ?? 0} rooms</span>
                {manage && (
                  <ActionForm action={archiveFloorAction.bind(null, propertyId, f.id, true)}>
                    <ConfirmButton size="sm" variant="ghost" confirmLabel="Archive floor">
                      Archive
                    </ConfirmButton>
                  </ActionForm>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {archived.length > 0 && (
        <details className="rounded-ui border border-border bg-surface px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium">Archived floors ({archived.length})</summary>
          <ul className="mt-3 space-y-2">
            {archived.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">{f.name}</span>
                {manage && (
                  <ActionForm action={archiveFloorAction.bind(null, propertyId, f.id, false)}>
                    <Button size="sm" variant="secondary" type="submit">
                      Restore
                    </Button>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
