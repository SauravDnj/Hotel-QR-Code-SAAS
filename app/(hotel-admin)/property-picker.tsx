import Link from "next/link";
import type { Db } from "@/lib/db/types";
import { can, type TenantContext } from "@/lib/permissions/authorize";
import type { PermissionKey } from "@/lib/permissions/catalog";
import { cn } from "@/lib/utils";
import { listProperties } from "@/modules/properties/service";

/** Properties where the user holds `permission`, and the selected one (from ?property=). */
export async function propertiesFor(db: Db, ctx: TenantContext, permission: PermissionKey, requested?: string) {
  const props = (await listProperties(db, ctx)).filter((p) => can(ctx, permission, { propertyId: p.id }));
  const selected = props.find((p) => p.id === requested) ?? props[0] ?? null;
  return { props, selected };
}

export function PropertyPicker({ base, props, selectedId }: { base: string; props: { id: string; name: string }[]; selectedId: string }) {
  if (props.length < 2) return null;
  return (
    <nav aria-label="Property" className="flex flex-wrap gap-2 text-sm">
      {props.map((p) => (
        <Link
          key={p.id}
          href={`${base}?property=${p.id}`}
          aria-current={p.id === selectedId ? "page" : undefined}
          className={cn(
            "rounded-full border border-border px-3 py-1.5",
            p.id === selectedId ? "bg-primary text-primary-foreground" : "bg-surface hover:bg-surface-muted",
          )}
        >
          {p.name}
        </Link>
      ))}
    </nav>
  );
}
