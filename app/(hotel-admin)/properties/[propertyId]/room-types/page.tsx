import type { Metadata } from "next";
import { ActionForm, ConfirmButton } from "@/components/action-form";
import { PermissionDenied } from "@/components/permission-denied";
import { Button } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { can, canWrite } from "@/lib/permissions/authorize";
import { listCategories } from "@/modules/rooms/categories";
import { archiveCategoryAction, createCategoryAction, updateCategoryAction } from "../structure-actions";

export const metadata: Metadata = { title: "Room types" };

export default async function RoomTypesPage({ params }: { params: Promise<{ propertyId: string }> }) {
  const { propertyId } = await params;
  const ctx = await requireTenantContext();
  if (!can(ctx, "room.view", { propertyId })) return <PermissionDenied />;
  const rows = await listCategories(getDb(), ctx, propertyId, { includeArchived: true });
  const manage = canWrite(ctx, "room.manage", { propertyId });
  const live = rows.filter((r) => !r.archivedAt);
  const archived = rows.filter((r) => r.archivedAt);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Room types</h2>
        <p className="text-sm text-muted-foreground">Categories such as Standard, Deluxe or Suite, with default guest capacity.</p>
      </div>

      {manage && (
        <Card>
          <h3 className="mb-3 text-sm font-semibold">Add room type</h3>
          <ActionForm action={createCategoryAction.bind(null, propertyId)} className="grid gap-3 sm:grid-cols-[1fr_7rem_2fr_auto] sm:items-end" aria-label="Add room type">
            <label className="flex flex-col gap-1 text-sm">
              Name
              <Input name="name" placeholder="e.g. Deluxe" required />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Capacity
              <Input name="capacity" type="number" min={1} max={50} defaultValue={2} required />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Description (optional)
              <Input name="description" placeholder="King bed, city view" />
            </label>
            <Button type="submit">Add room type</Button>
          </ActionForm>
        </Card>
      )}

      {live.length === 0 ? (
        <EmptyState title="No room types yet" description="Add at least one room type before creating rooms." />
      ) : (
        <div className="divide-y divide-border rounded-ui border border-border bg-surface">
          {live.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              {manage ? (
                <ActionForm
                  action={updateCategoryAction.bind(null, propertyId, c.id)}
                  className="flex flex-wrap items-center gap-2"
                  aria-label={`Edit ${c.name}`}
                >
                  <Input name="name" defaultValue={c.name} aria-label="Room type name" className="w-44" required />
                  <Input name="capacity" type="number" min={1} max={50} defaultValue={c.capacity} aria-label="Capacity" className="w-20" />
                  <Input name="description" defaultValue={c.description ?? ""} aria-label="Description" className="w-64" />
                  <Button type="submit" variant="secondary" size="sm">
                    Save
                  </Button>
                </ActionForm>
              ) : (
                <div>
                  <p className="font-medium">{c.name}</p>
                  <p className="text-sm text-muted-foreground">
                    Up to {c.capacity} guests{c.description ? ` · ${c.description}` : ""}
                  </p>
                </div>
              )}
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">{c.roomCount ?? 0} rooms</span>
                {manage && (
                  <ActionForm action={archiveCategoryAction.bind(null, propertyId, c.id, true)}>
                    <ConfirmButton size="sm" variant="ghost" confirmLabel="Archive type">
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
          <summary className="cursor-pointer text-sm font-medium">Archived room types ({archived.length})</summary>
          <ul className="mt-3 space-y-2">
            {archived.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">{c.name}</span>
                {manage && (
                  <ActionForm action={archiveCategoryAction.bind(null, propertyId, c.id, false)}>
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
