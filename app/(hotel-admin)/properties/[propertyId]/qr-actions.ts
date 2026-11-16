"use server";

import { revalidatePath } from "next/cache";
import { formValues, toActionState, type ActionState } from "@/lib/actions";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { portalInputFromForm, updatePortalSettings } from "@/modules/guest-portal/settings";
import { deactivateRoomQr, issueMissingQr, issueRoomQr, reactivateRoomQr, rotateRoomQr } from "@/modules/qr/service";

// Ids bound from the page are re-validated by the services against the caller's tenant
// and property scope; nothing here trusts them.

async function run(propertyId: string, fd: FormData, fn: () => Promise<string>): Promise<ActionState> {
  const values = formValues(fd);
  let message: string;
  try {
    message = await fn();
  } catch (err) {
    return toActionState(err, values);
  }
  revalidatePath(`/properties/${propertyId}`, "layout");
  return { ok: true, message };
}

const ctx = () => requireTenantContext();

export async function issueRoomQrAction(propertyId: string, roomId: string, _p: ActionState, fd: FormData) {
  return run(propertyId, fd, async () => {
    await issueRoomQr(getDb(), await ctx(), propertyId, roomId);
    return "QR code created.";
  });
}

export async function rotateRoomQrAction(propertyId: string, roomId: string, _p: ActionState, fd: FormData) {
  return run(propertyId, fd, async () => {
    const reason = fd.get("reason") === "compromised" ? "compromised" : "rotated";
    await rotateRoomQr(getDb(), await ctx(), propertyId, roomId, reason);
    return "New QR code issued. The old printed code no longer works; print and replace it.";
  });
}

export async function deactivateRoomQrAction(propertyId: string, roomId: string, _p: ActionState, fd: FormData) {
  return run(propertyId, fd, async () => {
    await deactivateRoomQr(getDb(), await ctx(), propertyId, roomId);
    return "QR code deactivated. Guests scanning it now see an unavailable page.";
  });
}

export async function reactivateRoomQrAction(propertyId: string, roomId: string, qrId: string, _p: ActionState, fd: FormData) {
  return run(propertyId, fd, async () => {
    await reactivateRoomQr(getDb(), await ctx(), propertyId, roomId, qrId);
    return "QR code reactivated.";
  });
}

export async function issueMissingQrAction(propertyId: string, _p: ActionState, fd: FormData) {
  return run(propertyId, fd, async () => {
    const floorId = (fd.get("floorId") as string) || undefined;
    const { count } = await issueMissingQr(getDb(), await ctx(), propertyId, { floorId });
    return count === 0 ? "Every room already has a QR code." : `${count} QR code${count === 1 ? "" : "s"} created.`;
  });
}

export async function updatePortalAction(propertyId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  // formValues() drops password fields, so the Wi-Fi password is never echoed back.
  const values = formValues(fd);
  try {
    await updatePortalSettings(getDb(), await ctx(), propertyId, portalInputFromForm(Object.fromEntries(
      [...fd.entries()].filter(([, v]) => typeof v === "string") as [string, string][],
    )));
  } catch (err) {
    return toActionState(err, values);
  }
  revalidatePath(`/properties/${propertyId}`, "layout");
  return { ok: true, message: "Guest portal saved." };
}
