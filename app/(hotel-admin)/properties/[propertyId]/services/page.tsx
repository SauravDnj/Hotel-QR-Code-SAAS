import type { Metadata } from "next";
import { ActionForm, ConfirmButton } from "@/components/action-form";
import { PermissionDenied } from "@/components/permission-denied";
import { ServiceIcon } from "@/components/service-icon";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { loadOr404 } from "@/lib/page-errors";
import { can, canWrite } from "@/lib/permissions/authorize";
import { listDepartments } from "@/modules/departments/service";
import { listServices, SERVICE_ICONS } from "@/modules/services/catalog";
import {
  archiveServiceAction,
  createDefaultServicesAction,
  createServiceAction,
  updateServiceAction,
} from "./service-actions";

export const metadata: Metadata = { title: "Services" };

type Values = {
  name?: string;
  description?: string | null;
  departmentId?: string;
  icon?: string;
  enabled?: boolean;
  maxQuantity?: number;
  options?: string[];
  noteMode?: string;
  availableFrom?: string | null;
  availableTo?: string | null;
  ackMessage?: string | null;
  priority?: string;
  targetMinutes?: number;
  escalate?: boolean;
  sortOrder?: number;
};

const label = "flex flex-col gap-1 text-sm";
const area = "block w-full rounded-ui border border-border bg-surface px-3 py-2 text-sm";

function ServiceFields({ v, departments, idp }: { v: Values; departments: { id: string; name: string }[]; idp: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className={label}>
        Name
        <Input name="name" id={`${idp}-name`} required maxLength={60} defaultValue={v.name ?? ""} />
      </label>
      <label className={label}>
        Department (routing)
        <Select name="departmentId" id={`${idp}-dept`} defaultValue={v.departmentId ?? ""} required>
          <option value="" disabled>
            Choose…
          </option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
      </label>
      <label className={`${label} sm:col-span-2`}>
        Description shown to guests
        <Input name="description" id={`${idp}-desc`} maxLength={200} defaultValue={v.description ?? ""} />
      </label>
      <label className={label}>
        Icon
        <Select name="icon" id={`${idp}-icon`} defaultValue={v.icon ?? "bell"}>
          {SERVICE_ICONS.map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </Select>
      </label>
      <label className={label}>
        Max quantity (0 = no quantity)
        <Input name="maxQuantity" id={`${idp}-qty`} type="number" min={0} max={20} defaultValue={v.maxQuantity ?? 0} />
      </label>
      <label className={`${label} sm:col-span-2`}>
        Choices for the guest (one per line, optional)
        <textarea name="options" id={`${idp}-opts`} rows={3} className={area} defaultValue={(v.options ?? []).join("\n")} />
      </label>
      <label className={label}>
        Guest note
        <Select name="noteMode" id={`${idp}-note`} defaultValue={v.noteMode ?? "optional"}>
          <option value="none">No note</option>
          <option value="optional">Optional</option>
          <option value="required">Required</option>
        </Select>
      </label>
      <label className={label}>
        Priority
        <Select name="priority" id={`${idp}-prio`} defaultValue={v.priority ?? "normal"}>
          {["low", "normal", "high", "urgent"].map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
      </label>
      <label className={label}>
        Available from (blank = all day)
        <Input name="availableFrom" id={`${idp}-from`} type="time" defaultValue={v.availableFrom ?? ""} />
      </label>
      <label className={label}>
        Available until
        <Input name="availableTo" id={`${idp}-to`} type="time" defaultValue={v.availableTo ?? ""} />
      </label>
      <label className={label}>
        Target response (minutes)
        <Input name="targetMinutes" id={`${idp}-target`} type="number" min={1} max={1440} defaultValue={v.targetMinutes ?? 15} />
      </label>
      <label className={label}>
        Order
        <Input name="sortOrder" id={`${idp}-sort`} type="number" min={0} max={999} defaultValue={v.sortOrder ?? 0} />
      </label>
      <label className={`${label} sm:col-span-2`}>
        Confirmation shown to the guest
        <Input name="ackMessage" id={`${idp}-ack`} maxLength={200} defaultValue={v.ackMessage ?? ""} />
      </label>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" name="enabled" defaultChecked={v.enabled ?? true} className="size-4" />
        Shown to guests
      </label>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" name="escalate" defaultChecked={v.escalate ?? true} className="size-4" />
        Escalate to managers if not accepted within the target time
      </label>
    </div>
  );
}

export default async function ServicesPage({ params }: { params: Promise<{ propertyId: string }> }) {
  const { propertyId } = await params;
  const ctx = await requireTenantContext();
  if (!can(ctx, "property.view", { propertyId })) return <PermissionDenied />;
  const db = getDb();
  const [{ items }, depts] = await loadOr404(() => Promise.all([listServices(db, ctx, propertyId), listDepartments(db, ctx, propertyId)]));
  const manage = canWrite(ctx, "service.manage", { propertyId });
  const departments = depts.filter((d) => d.status === "active").map((d) => ({ id: d.id, name: d.name }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Guest services</h2>
          <p className="text-sm text-muted-foreground">
            Tiles on the guest page. Each request goes to the department you choose here.
          </p>
        </div>
        {manage && (
          <ActionForm action={createDefaultServicesAction.bind(null, propertyId)}>
            <Button type="submit" variant={items.length ? "secondary" : "primary"}>
              Add standard services
            </Button>
          </ActionForm>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="No services yet"
          description="Add the standard set (water, housekeeping, reception, maintenance, custom request) and adjust it."
        />
      ) : (
        <ul className="space-y-3" aria-label="Services">
          {items.map((s) => (
            <li key={s.id}>
              <Card className="p-0">
                <details>
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 p-4">
                    <ServiceIcon name={s.icon} className="size-5 text-muted-foreground" />
                    <span className="font-medium">{s.name}</span>
                    <span className="text-sm text-muted-foreground">→ {s.departmentName}</span>
                    {s.enabled ? <Badge tone="success">Shown</Badge> : <Badge tone="warning">Hidden</Badge>}
                    {s.departmentStatus !== "active" && <Badge tone="danger">Department inactive</Badge>}
                    {s.availableFrom && (
                      <span className="text-xs text-muted-foreground">
                        {s.availableFrom}–{s.availableTo}
                      </span>
                    )}
                  </summary>
                  <div className="space-y-3 border-t border-border p-4">
                    <ActionForm action={updateServiceAction.bind(null, propertyId, s.id)} className="space-y-3" aria-label={`Edit ${s.name}`}>
                      <fieldset disabled={!manage} className="space-y-3">
                        <ServiceFields v={s} departments={departments} idp={s.id} />
                        {manage && <Button type="submit">Save</Button>}
                      </fieldset>
                    </ActionForm>
                    {manage && (
                      <ActionForm action={archiveServiceAction.bind(null, propertyId, s.id)}>
                        <ConfirmButton size="sm" variant="ghost" confirmLabel="Yes, remove">
                          Remove service
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

      {manage && departments.length > 0 && (
        <Card>
          <details>
            <summary className="cursor-pointer text-sm font-semibold">Add a custom service</summary>
            <ActionForm action={createServiceAction.bind(null, propertyId)} className="mt-4 space-y-3" aria-label="Add service">
              <ServiceFields v={{}} departments={departments} idp="new" />
              <Button type="submit">Add service</Button>
            </ActionForm>
          </details>
        </Card>
      )}
    </div>
  );
}
