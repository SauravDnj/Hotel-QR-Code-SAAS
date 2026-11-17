import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, ConfirmButton } from "@/components/action-form";
import { PermissionDenied } from "@/components/permission-denied";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { formatMoney, toMajorString } from "@/lib/money";
import { loadOr404 } from "@/lib/page-errors";
import { can, canWrite } from "@/lib/permissions/authorize";
import { listMenu } from "@/modules/ordering/menu";
import { archiveMenuItemAction, createMenuItemAction, updateMenuItemAction } from "../../service-actions";

export const metadata: Metadata = { title: "Menu" };

const label = "flex flex-col gap-1 text-sm";

function ItemFields({ idp, v, currency }: { idp: string; currency: string; v: { section?: string | null; name?: string; description?: string | null; priceMinor?: number; available?: boolean; sortOrder?: number } }) {
  return (
    <div className="grid gap-3 sm:grid-cols-6">
      <label className={`${label} sm:col-span-2`}>
        Name
        <Input name="name" id={`${idp}-name`} required maxLength={80} defaultValue={v.name ?? ""} />
      </label>
      <label className={label}>
        Price ({currency})
        <Input name="price" id={`${idp}-price`} required inputMode="decimal" defaultValue={v.priceMinor !== undefined ? toMajorString(v.priceMinor, currency) : ""} />
      </label>
      <label className={label}>
        Section
        <Input name="section" id={`${idp}-section`} maxLength={40} defaultValue={v.section ?? ""} placeholder="e.g. Breakfast" />
      </label>
      <label className={label}>
        Order
        <Input name="sortOrder" id={`${idp}-sort`} type="number" min={0} max={999} defaultValue={v.sortOrder ?? 0} />
      </label>
      <label className="flex min-h-11 items-center gap-2 self-end text-sm">
        <input type="checkbox" name="available" defaultChecked={v.available ?? true} className="size-4" />
        Available
      </label>
      <label className={`${label} sm:col-span-6`}>
        Description (optional)
        <Input name="description" id={`${idp}-desc`} maxLength={200} defaultValue={v.description ?? ""} />
      </label>
    </div>
  );
}

/** Menu items and prices of a menu service. Guests see available items only. */
export default async function MenuPage({ params }: { params: Promise<{ propertyId: string; serviceId: string }> }) {
  const { propertyId, serviceId } = await params;
  const ctx = await requireTenantContext();
  if (!can(ctx, "property.view", { propertyId })) return <PermissionDenied />;
  const db = getDb();
  const { property, service, items } = await loadOr404(() => listMenu(db, ctx, propertyId, serviceId));
  const manage = canWrite(ctx, "service.manage", { propertyId });

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/properties/${propertyId}/services`} className="text-sm text-primary underline underline-offset-4">
          ← Services
        </Link>
        <h2 className="mt-2 text-lg font-semibold">{service.name}: menu</h2>
        <p className="text-sm text-muted-foreground">
          Prices in {property.currency}. Orders are priced on the server from this list; changes apply to new orders only.
        </p>
      </div>

      {items.length === 0 ? (
        <EmptyState title="No items yet" description="Add the dishes or garments guests can order." />
      ) : (
        <ul className="space-y-3" aria-label="Menu items">
          {items.map((m) => (
            <li key={m.id}>
              <Card className="p-0">
                <details>
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 p-4">
                    <span className="font-medium">{m.name}</span>
                    <span className="text-sm">{formatMoney(m.priceMinor, property.currency)}</span>
                    {m.section && <span className="text-xs text-muted-foreground">{m.section}</span>}
                    {!m.available && <Badge tone="warning">Unavailable</Badge>}
                  </summary>
                  <div className="space-y-3 border-t border-border p-4">
                    <ActionForm action={updateMenuItemAction.bind(null, propertyId, m.id)} className="space-y-3" aria-label={`Edit ${m.name}`}>
                      <fieldset disabled={!manage} className="space-y-3">
                        <ItemFields idp={m.id} v={m} currency={property.currency} />
                        {manage && <Button type="submit">Save</Button>}
                      </fieldset>
                    </ActionForm>
                    {manage && (
                      <ActionForm action={archiveMenuItemAction.bind(null, propertyId, m.id)}>
                        <ConfirmButton size="sm" variant="ghost" confirmLabel="Yes, remove">
                          Remove item
                        </ConfirmButton>
                      </ActionForm>
                    )}
                  </div>
                </details>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {manage && (
        <Card>
          <h3 className="mb-3 text-sm font-semibold">Add item</h3>
          <ActionForm action={createMenuItemAction.bind(null, propertyId, service.id)} className="space-y-3" aria-label="Add menu item">
            <ItemFields idp="new" v={{}} currency={property.currency} />
            <Button type="submit">Add item</Button>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
