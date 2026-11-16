"use server";

import { revalidatePath } from "next/cache";
import { signOut } from "@/auth";
import { formValues, toActionState, type ActionState } from "@/lib/actions";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { changePassword, updateName, updateNotificationPrefs } from "@/modules/staff/profile";

export async function updateNameAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd);
  try {
    await updateName(getDb(), await requireTenantContext(), values);
  } catch (err) {
    return toActionState(err, values);
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Name saved." };
}

export async function updatePrefsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd);
  try {
    await updateNotificationPrefs(getDb(), await requireTenantContext(), {
      notifySound: values.notifySound === "on",
      notifyScope: values.notifyScope as "all" | "mine",
    });
  } catch (err) {
    return toActionState(err, values);
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Notification settings saved." };
}

/** Every session (this one included) ends after a password change; sign in again. */
export async function changePasswordAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await changePassword(getDb(), await requireTenantContext(), {
      currentPassword: String(fd.get("currentPassword") ?? ""),
      newPassword: String(fd.get("newPassword") ?? ""),
    });
  } catch (err) {
    return toActionState(err);
  }
  await signOut({ redirectTo: "/login?changed=1" });
  return { ok: true };
}
