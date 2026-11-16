import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { PermissionDenied } from "@/components/permission-denied";
import { Button } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/card";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { can, canWrite } from "@/lib/permissions/authorize";
import { formatDateTime } from "@/lib/utils";
import { listGrantableRoles, listOpenInvitations, listStaff } from "@/modules/staff/service";
import { revokeInviteAction } from "./actions";
import { InviteForm } from "./invite-form";
import { scopeLabel, scopeOptions } from "./scope";

export const metadata: Metadata = { title: "Staff" };

export default async function StaffPage() {
  const ctx = await requireTenantContext();
  if (!can(ctx, "staff.view")) return <PermissionDenied />;
  const db = getDb();
  // The staff screens are for tenant-wide managers; property-scoped access is enforced by the services.
  const manage = canWrite(ctx, "staff.manage");
  const [staff, invites, roles, scopes] = await Promise.all([
    listStaff(db, ctx),
    listOpenInvitations(db, ctx),
    manage ? listGrantableRoles(db, ctx) : Promise.resolve([]),
    manage ? scopeOptions(db, ctx) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Staff</h1>
          <p className="text-sm text-muted-foreground">Who can sign in to this hotel, with which role and where.</p>
        </div>
        {can(ctx, "role.manage") && (
          <Link href="/staff/roles" className="text-sm text-primary underline-offset-4 hover:underline">
            Roles & permissions →
          </Link>
        )}
      </div>

      {manage && (
        <Card>
          <h2 className="mb-3 text-sm font-semibold">Invite a staff member</h2>
          <InviteForm roles={roles} scopes={scopes} />
          <p className="mt-3 text-xs text-muted-foreground">
            You can only give roles whose permissions you have yourself. The link is shown once; share it privately.
          </p>
        </Card>
      )}

      {invites.length > 0 && (
        <Card>
          <h2 className="mb-3 text-sm font-semibold">Open invitations</h2>
          <ul className="divide-y divide-border text-sm" aria-label="Open invitations">
            {invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-medium">{i.name}</span> · {i.email} · {i.roleName} ·{" "}
                  {scopeLabel(i)} <span className="text-muted-foreground">· expires {formatDateTime(i.expiresAt, "UTC")}</span>
                </span>
                {manage && (
                  <ActionForm action={revokeInviteAction.bind(null, i.id)}>
                    <Button type="submit" size="sm" variant="ghost">
                      Revoke
                    </Button>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Roles</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Last sign-in</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.membershipId} className="border-b border-border last:border-0">
                <td className="px-4 py-2">
                  <Link href={`/staff/${s.membershipId}`} className="font-medium text-primary underline-offset-4 hover:underline">
                    {s.name}
                  </Link>
                  <div className="text-xs text-muted-foreground">{s.email}</div>
                </td>
                <td className="px-4 py-2">
                  {s.assignments.length === 0 ? (
                    <span className="text-muted-foreground">No role</span>
                  ) : (
                    s.assignments.map((a) => (
                      <div key={a.id}>
                        {a.roleName} <span className="text-xs text-muted-foreground">· {scopeLabel(a)}</span>
                      </div>
                    ))
                  )}
                </td>
                <td className="px-4 py-2">
                  {s.status === "active" ? <Badge tone="success">Active</Badge> : <Badge tone="danger">Deactivated</Badge>}
                  {s.membershipId === ctx.membershipId && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                </td>
                <td className="px-4 py-2 text-muted-foreground">{s.lastLoginAt ? formatDateTime(s.lastLoginAt, "UTC") : "Never"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
