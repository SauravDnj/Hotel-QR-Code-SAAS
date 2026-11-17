"use server";

import { revalidatePath } from "next/cache";
import { signOut } from "@/auth";
import { formValues, toActionState, type ActionState } from "@/lib/actions";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { changePassword, updateName, updateNotificationPrefs } from "@/modules/staff/profile";
import { headers } from "next/headers";
import { defaultSenders } from "@/lib/notifications/senders";
import { removeDevice, removePushSubscription, savePushSubscription, sendTestPush } from "@/modules/notifications/service";

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
      notifyPush: values.notifyPush === "on",
      alertPhone: values.alertPhone ?? "",
      escalationChannel: (values.escalationChannel ?? "none") as "none",
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

// ---------------------------------------------------------------- phone notifications (Phase 9)

/** Called by the browser after the user allowed notifications; stores this device's subscription. */
export async function subscribePushAction(subscriptionJson: string): Promise<{ ok: boolean; message: string }> {
  try {
    const ua = (await headers()).get("user-agent");
    await savePushSubscription(getDb(), await requireTenantContext(), JSON.parse(subscriptionJson), ua);
  } catch (err) {
    const state = toActionState(err);
    return { ok: false, message: state.message ?? "Couldn't turn on notifications." };
  }
  revalidatePath("/profile");
  return { ok: true, message: "Notifications are on for this device." };
}

export async function unsubscribePushAction(endpoint: string): Promise<{ ok: boolean; message: string }> {
  try {
    await removePushSubscription(getDb(), await requireTenantContext(), endpoint);
  } catch (err) {
    return { ok: false, message: toActionState(err).message ?? "Couldn't turn off notifications." };
  }
  revalidatePath("/profile");
  return { ok: true, message: "Notifications are off for this device." };
}

export async function testPushAction(): Promise<ActionState> {
  try {
    const res = await sendTestPush(getDb(), await requireTenantContext(), defaultSenders());
    if (!res.configured) return { ok: false, message: "Phone notifications aren't set up for this service yet." };
    return res.sent > 0 ? { ok: true, message: `Test sent to ${res.sent} device${res.sent === 1 ? "" : "s"}.` } : { ok: false, message: "No device received it. Turn notifications on first." };
  } catch (err) {
    return toActionState(err);
  }
}

export async function removeDeviceAction(id: string): Promise<ActionState> {
  try {
    await removeDevice(getDb(), await requireTenantContext(), id);
  } catch (err) {
    return toActionState(err);
  }
  revalidatePath("/profile");
  return { ok: true, message: "Device removed." };
}
