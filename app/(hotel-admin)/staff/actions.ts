"use server";

import { revalidatePath } from "next/cache";
import { formValues, toActionState, type ActionState } from "@/lib/actions";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { serverEnv } from "@/lib/env";
import type { PermissionKey } from "@/lib/permissions/catalog";
import { createRole, deleteRole, updateRole } from "@/modules/staff/roles";
import { addAssignment, createInvitation, removeAssignment, revokeInvitation, setMemberStatus } from "@/modules/staff/service";

/** "propertyId:departmentId" from one select; either part may be empty. */
function parseScope(v: string | undefined) {
  const [propertyId = "", departmentId = ""] = (v ?? "").split(":");
  return { propertyId, departmentId };
}

async function run(fd: FormData, fn: (v: Record<string, string>) => Promise<string>): Promise<ActionState> {
  const values = formValues(fd);
  let message: string;
  try {
    message = await fn(values);
  } catch (err) {
    return toActionState(err, values);
  }
  revalidatePath("/staff", "layout");
  return { ok: true, message };
}

export interface InviteState extends ActionState {
  link?: string;
}

export async function inviteAction(_p: InviteState, fd: FormData): Promise<InviteState> {
  const values = formValues(fd);
  try {
    const ctx = await requireTenantContext();
    const inv = await createInvitation(getDb(), ctx, {
      email: values.email ?? "",
      name: values.name ?? "",
      roleId: values.roleId ?? "",
      ...parseScope(values.scope),
    });
    revalidatePath("/staff");
    const base = serverEnv().APP_URL.replace(/\/+$/, "");
    return { ok: true, message: "Invitation created. Send this link to them (valid for 7 days, single use):", link: `${base}/invite/${inv.token}` };
  } catch (err) {
    return toActionState(err, values);
  }
}

export async function revokeInviteAction(invitationId: string, _p: ActionState, fd: FormData) {
  return run(fd, async () => {
    await revokeInvitation(getDb(), await requireTenantContext(), invitationId);
    return "Invitation revoked.";
  });
}

export async function addAssignmentAction(membershipId: string, _p: ActionState, fd: FormData) {
  return run(fd, async (v) => {
    await addAssignment(getDb(), await requireTenantContext(), membershipId, { roleId: v.roleId ?? "", ...parseScope(v.scope) });
    return "Role added.";
  });
}

export async function removeAssignmentAction(membershipId: string, assignmentId: string, _p: ActionState, fd: FormData) {
  return run(fd, async () => {
    await removeAssignment(getDb(), await requireTenantContext(), membershipId, assignmentId);
    return "Role removed.";
  });
}

export async function setStatusAction(membershipId: string, status: "active" | "disabled", _p: ActionState, fd: FormData) {
  return run(fd, async () => {
    await setMemberStatus(getDb(), await requireTenantContext(), membershipId, status);
    return status === "disabled" ? "Access removed." : "Access restored.";
  });
}

const perms = (fd: FormData) => fd.getAll("permissions").filter((v): v is string => typeof v === "string") as PermissionKey[];

export async function createRoleAction(_p: ActionState, fd: FormData) {
  return run(fd, async (v) => {
    await createRole(getDb(), await requireTenantContext(), { name: v.name ?? "", description: v.description, permissions: perms(fd) });
    return "Role created.";
  });
}

export async function updateRoleAction(roleId: string, _p: ActionState, fd: FormData) {
  return run(fd, async (v) => {
    await updateRole(getDb(), await requireTenantContext(), roleId, { name: v.name ?? "", description: v.description, permissions: perms(fd) });
    return "Role saved.";
  });
}

export async function deleteRoleAction(roleId: string, _p: ActionState, fd: FormData) {
  return run(fd, async () => {
    await deleteRole(getDb(), await requireTenantContext(), roleId);
    return "Role deleted.";
  });
}
