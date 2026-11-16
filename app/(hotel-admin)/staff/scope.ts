import "server-only";
import type { Db } from "@/lib/db/types";
import { propertyScope, type TenantContext } from "@/lib/permissions/authorize";
import { listDepartments } from "@/modules/departments/service";
import { listProperties } from "@/modules/properties/service";

/**
 * Options for the single "Where" picker: whole hotel, one property, or one department of a
 * property. Values are "propertyId:departmentId". The server re-validates every choice.
 */
export async function scopeOptions(db: Db, ctx: TenantContext) {
  const props = await listProperties(db, ctx);
  const wide = propertyScope(ctx, "staff.manage") === "all";
  const options: { value: string; label: string }[] = wide ? [{ value: "", label: "All properties" }] : [];
  for (const p of props) {
    options.push({ value: `${p.id}:`, label: `${p.name} (all departments)` });
    const depts = await listDepartments(db, ctx, p.id).catch(() => []);
    for (const d of depts.filter((x) => x.status === "active")) {
      options.push({ value: `${p.id}:${d.id}`, label: `${p.name} → ${d.name} only` });
    }
  }
  return options;
}

export function scopeLabel(a: { propertyName: string | null; departmentName: string | null }) {
  if (!a.propertyName) return "All properties";
  return a.departmentName ? `${a.propertyName} → ${a.departmentName}` : a.propertyName;
}
