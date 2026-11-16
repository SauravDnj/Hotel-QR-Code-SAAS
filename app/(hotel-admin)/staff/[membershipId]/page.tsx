import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, ConfirmButton } from "@/components/action-form";
import { PermissionDenied } from "@/components/permission-denied";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { loadOr404 } from "@/lib/page-errors";
import { can, canWrite } from "@/lib/permissions/authorize";
import { formatDateTime } from "@/lib/utils";
import { getMember, listGrantableRoles } from "@/modules/staff/service";
import { addAssignmentAction, removeAssignmentAction, setStatusAction } from "../actions";
import { scopeLabel, scopeOptions } from "../scope";

export const metadata: Metadata = { title: "Staff member" };

export default async function MemberPage({ params }: { params: Promise<{ membershipId: string }> }) {
  const { membershipId } = await params;
  const ctx = await requireTenantContext();
  if (!can(ctx, "staff.view")) return <PermissionDenied />;
  const db = getDb();
  const m = await loadOr404(() => getMember(db, ctx, membershipId));
  const self = m.membershipId === ctx.membershipId;
  const manage = !self && canWrite(ctx, "staff.manage");
  const [roles, scopes] = manage ? await Promise.all([listGrantableRoles(db, ctx), scopeOptions(db, ctx)]) : [[], []];

  return (
    <div className="space-y-5">
      <Link href="/staff" className="text-sm text-primary underline underline-offset-4">
        ← All staff
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{m.name}</h1>
        {m.status === "active" ? <Badge tone="success">Active</Badge> : <Badge tone="danger">Deactivated</Badge>}
      </div>
      <p className="text-sm text-muted-foreground">
        {m.email} · last sign-in {m.lastLoginAt ? formatDateTime(m.lastLoginAt, "UTC") : "never"}
      </p>
      {self && <Alert tone="info">This is you. Another owner or manager has to change your access.</Alert>}

      <Card>
        <h2 className="mb-3 text-sm font-semibold">Roles</h2>
        {m.assignments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No role: this person can sign in but sees nothing.</p>
        ) : (
          <ul className="divide-y divide-border text-sm" aria-label="Roles">
            {m.assignments.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-medium">{a.roleName}</span> · {scopeLabel(a)}
                </span>
                {manage && (
                  <ActionForm action={removeAssignmentAction.bind(null, m.membershipId, a.id)}>
                    <ConfirmButton size="sm" variant="ghost" confirmLabel="Yes, remove">
                      Remove
                    </ConfirmButton>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        )}
        {manage && (
          <ActionForm
            action={addAssignmentAction.bind(null, m.membershipId)}
            className="mt-4 flex flex-wrap items-end gap-2 border-t border-border pt-4"
            aria-label="Add role"
          >
            <Select name="roleId" required defaultValue="" aria-label="Role" className="w-48">
              <option value="" disabled>
                Role…
              </option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
            <Select name="scope" aria-label="Where" defaultValue={scopes[0]?.value ?? ""} className="w-72">
              {scopes.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
            <Button type="submit">Add role</Button>
          </ActionForm>
        )}
      </Card>

      {manage && (
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">{m.status === "active" ? "Remove access" : "Restore access"}</h2>
            <p className="text-xs text-muted-foreground">
              {m.status === "active"
                ? "They are signed out of this hotel immediately. History and their requests are kept."
                : "They can sign in to this hotel again with their existing roles."}
            </p>
          </div>
          <ActionForm action={setStatusAction.bind(null, m.membershipId, m.status === "active" ? "disabled" : "active")}>
            {m.status === "active" ? (
              <ConfirmButton variant="secondary" confirmLabel="Yes, remove access">
                Deactivate
              </ConfirmButton>
            ) : (
              <Button type="submit">Reactivate</Button>
            )}
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
