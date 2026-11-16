import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, ConfirmButton } from "@/components/action-form";
import { PermissionDenied } from "@/components/permission-denied";
import { Button } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { can, canWrite } from "@/lib/permissions/authorize";
import { ALL_PERMISSION_KEYS, PERMISSIONS, type PermissionKey } from "@/lib/permissions/catalog";
import { listRoles } from "@/modules/staff/roles";
import { createRoleAction, deleteRoleAction, updateRoleAction } from "../actions";

export const metadata: Metadata = { title: "Roles" };

const GROUPS = [...new Set(ALL_PERMISSION_KEYS.map((k) => k.split(".")[0]))];

function PermissionPicker({ selected, grantable, idp }: { selected: PermissionKey[]; grantable: Set<PermissionKey>; idp: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {GROUPS.map((g) => (
        <fieldset key={g} className="rounded-ui border border-border p-3">
          <legend className="px-1 text-xs font-semibold uppercase text-muted-foreground">{g}</legend>
          {ALL_PERMISSION_KEYS.filter((k) => k.startsWith(`${g}.`)).map((k) => (
            <label key={k} className="flex min-h-9 items-center gap-2 text-sm" title={grantable.has(k) ? k : "You don't have this permission"}>
              <input
                type="checkbox"
                name="permissions"
                value={k}
                id={`${idp}-${k}`}
                defaultChecked={selected.includes(k)}
                disabled={!grantable.has(k)}
                className="size-4"
              />
              {PERMISSIONS[k]}
            </label>
          ))}
        </fieldset>
      ))}
    </div>
  );
}

export default async function RolesPage() {
  const ctx = await requireTenantContext();
  if (!can(ctx, "staff.view")) return <PermissionDenied />;
  const all = await listRoles(getDb(), ctx);
  const manage = canWrite(ctx, "role.manage");
  // You can only put permissions you hold yourself into a role.
  const grantable = new Set(ALL_PERMISSION_KEYS.filter((k) => can(ctx, k)));

  return (
    <div className="space-y-6">
      <Link href="/staff" className="text-sm text-primary underline underline-offset-4">
        ← Staff
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Roles & permissions</h1>
        <p className="text-sm text-muted-foreground">
          Standard roles are maintained by the platform. Create custom roles for anything else; changes apply on each
          person&apos;s next page load.
        </p>
      </div>

      <ul className="space-y-3" aria-label="Roles">
        {all.map((r) => (
          <li key={r.id}>
            <Card className="p-0">
              <details>
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 p-4">
                  <span className="font-medium">{r.name}</span>
                  {r.custom ? <Badge tone="warning">Custom</Badge> : <Badge>Standard</Badge>}
                  <span className="text-xs text-muted-foreground">
                    {r.permissions.length} permissions · {r.assignments} assigned
                  </span>
                </summary>
                <div className="space-y-3 border-t border-border p-4">
                  {r.custom && manage ? (
                    <>
                      <ActionForm action={updateRoleAction.bind(null, r.id)} className="space-y-3" aria-label={`Edit ${r.name}`}>
                        <div className="flex flex-wrap gap-2">
                          <Input name="name" id={`${r.id}-name`} defaultValue={r.name} aria-label="Role name" className="w-64" required />
                          <Input name="description" id={`${r.id}-desc`} defaultValue={r.description ?? ""} aria-label="Description" className="w-80" />
                        </div>
                        <PermissionPicker selected={r.permissions} grantable={grantable} idp={r.id} />
                        <Button type="submit">Save role</Button>
                      </ActionForm>
                      <ActionForm action={deleteRoleAction.bind(null, r.id)}>
                        <ConfirmButton size="sm" variant="ghost" confirmLabel="Yes, delete">
                          Delete role
                        </ConfirmButton>
                      </ActionForm>
                    </>
                  ) : (
                    <>
                      {r.description && <p className="text-sm text-muted-foreground">{r.description}</p>}
                      <ul className="flex flex-wrap gap-1.5">
                        {r.permissions.map((p) => (
                          <li key={p} className="rounded-full bg-surface-muted px-2 py-0.5 text-xs" title={p}>
                            {PERMISSIONS[p]}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              </details>
            </Card>
          </li>
        ))}
      </ul>

      {manage && (
        <Card>
          <h2 className="mb-3 text-sm font-semibold">Create a custom role</h2>
          <ActionForm action={createRoleAction} className="space-y-3" aria-label="Create role">
            <div className="flex flex-wrap gap-2">
              <Input name="name" id="new-role-name" placeholder="e.g. Night auditor" aria-label="Role name" className="w-64" required />
              <Input name="description" id="new-role-desc" placeholder="What is this role for?" aria-label="Description" className="w-80" />
            </div>
            <PermissionPicker selected={[]} grantable={grantable} idp="new" />
            <Button type="submit">Create role</Button>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
