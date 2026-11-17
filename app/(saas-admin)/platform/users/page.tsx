import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, PageHeader } from "@/components/ui/card";
import { requirePlatformAdmin } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { formatDateTime } from "@/lib/utils";
import { listPlatformUsers } from "@/modules/platform/admin";
import { platformAdminAction, userStatusAction } from "../actions";
import { LinkAction } from "../link-action";
import { resetLinkAction, resetMfaAction } from "../support/actions";
import { ReasonInput, StatusBadge, td, th } from "../ui";

export const metadata: Metadata = { title: "Users & staff" };

const TYPES = [
  { value: "all", label: "Everyone" },
  { value: "admins", label: "Super admins" },
  { value: "disabled", label: "Blocked logins" },
  { value: "no_hotel", label: "Not in any hotel" },
] as const;

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string; type?: string }> }) {
  const actor = await requirePlatformAdmin();
  const sp = await searchParams;
  const rows = await listPlatformUsers(getDb(), actor, { q: sp.q, type: sp.type as never });

  return (
    <div>
      <PageHeader
        title="Users & staff"
        description={`${rows.length} login${rows.length === 1 ? "" : "s"}${rows.length === 300 ? " (first 300, refine your search)" : ""}. Every hotel owner and staff member on the platform.`}
      />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2" role="search" aria-label="Filter users">
        <label className="flex flex-col gap-1 text-xs">
          Search
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Name or email" className="min-h-10 w-64 rounded-ui border border-border bg-surface px-3 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Show
          <select name="type" defaultValue={sp.type ?? "all"} className="min-h-10 rounded-ui border border-border bg-surface px-3 text-sm">
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>

      {rows.length === 0 ? (
        <EmptyState title="No users found" description="Try another search." />
      ) : (
        <div className="overflow-x-auto rounded-ui border border-border bg-surface">
          <table className="w-full text-left text-sm" aria-label="Users">
            <thead className="border-b border-border bg-surface-muted text-muted-foreground">
              <tr>
                <th scope="col" className={th}>Person</th>
                <th scope="col" className={th}>Hotels & roles</th>
                <th scope="col" className={th}>Login</th>
                <th scope="col" className={th}>Last sign-in</th>
                <th scope="col" className={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => {
                const self = u.id === actor.userId;
                return (
                  <tr key={u.id} className="border-b border-border last:border-0">
                    <td className={td}>
                      <p className="font-medium">
                        {u.name} {self && <span className="text-xs text-muted-foreground">(you)</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">{u.email}</p>
                      {u.isPlatformAdmin && (
                        <p className="mt-1">
                          <Badge tone="success">Super admin</Badge>
                        </p>
                      )}
                    </td>
                    <td className={td}>
                      {u.hotels.length === 0
                        ? "—"
                        : u.hotels.map((h) => (
                            <p key={h.tenantId}>
                              <Link href={`/platform/tenants/${h.tenantId}`} className="text-primary underline-offset-4 hover:underline">
                                {h.tenant}
                              </Link>
                              <span className="text-xs text-muted-foreground">
                                {" "}
                                · {h.roles || "no role"}
                                {h.memberStatus !== "active" && ` · access ${h.memberStatus}`}
                              </span>
                            </p>
                          ))}
                    </td>
                    <td className={td}>
                      <StatusBadge status={u.status} />
                      <p className="mt-1 text-xs text-muted-foreground">{u.mfaEnabled ? "Two-step on" : "Password only"}</p>
                    </td>
                    <td className={`${td} whitespace-nowrap`}>{u.lastLoginAt ? formatDateTime(u.lastLoginAt, "UTC") : "never"}</td>
                    <td className={td}>
                      <details>
                        <summary className="cursor-pointer text-xs text-primary">Manage</summary>
                        <div className="mt-2 w-72 space-y-3">
                          <LinkAction action={resetLinkAction} email={u.email} submit="Reset password" />
                          {u.mfaEnabled && !self && <LinkAction action={resetMfaAction} email={u.email} submit="Reset two-step" variant="danger" />}
                          {!self && (
                            <ActionForm
                              action={userStatusAction.bind(null, u.id)}
                              className="flex flex-wrap items-center gap-1"
                              aria-label={`${u.status === "active" ? "Block" : "Unblock"} login for ${u.email}`}
                            >
                              <input type="hidden" name="status" value={u.status === "active" ? "disabled" : "active"} />
                              <ReasonInput label={`Reason for ${u.email} (audited)`} className="w-40 text-xs" />
                              <Button type="submit" size="sm" variant={u.status === "active" ? "danger" : "secondary"}>
                                {u.status === "active" ? "Block login" : "Unblock login"}
                              </Button>
                            </ActionForm>
                          )}
                          {!self && (u.isPlatformAdmin || u.mfaEnabled) && (
                            <ActionForm
                              action={platformAdminAction.bind(null, u.id)}
                              className="flex flex-wrap items-center gap-1"
                              aria-label={`${u.isPlatformAdmin ? "Remove" : "Make"} super admin: ${u.email}`}
                            >
                              <input type="hidden" name="grant" value={u.isPlatformAdmin ? "0" : "1"} />
                              <ReasonInput label={`Super admin reason for ${u.email} (audited)`} className="w-40 text-xs" />
                              <Button type="submit" size="sm" variant={u.isPlatformAdmin ? "danger" : "secondary"}>
                                {u.isPlatformAdmin ? "Remove super admin" : "Make super admin"}
                              </Button>
                            </ActionForm>
                          )}
                          {!self && !u.isPlatformAdmin && !u.mfaEnabled && (
                            <p className="text-xs text-muted-foreground">To make them a super admin they must first turn on two-step sign-in.</p>
                          )}
                        </div>
                      </details>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
