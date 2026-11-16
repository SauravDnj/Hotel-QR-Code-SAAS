"use server";

import { revalidatePath } from "next/cache";
import { formValues, toActionState, type ActionState } from "@/lib/actions";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { finishCleaning, inspectRoom, setRequireInspection, startCleaning } from "@/modules/housekeeping/service";

async function run(fn: () => Promise<string>, fd: FormData): Promise<ActionState> {
  const values = formValues(fd);
  let message: string;
  try {
    message = await fn();
  } catch (err) {
    return toActionState(err, values);
  }
  revalidatePath("/housekeeping");
  revalidatePath("/front-desk");
  return { ok: true, message };
}

export async function startCleaningAction(propertyId: string, roomId: string, _p: ActionState, fd: FormData) {
  return run(async () => {
    await startCleaning(getDb(), await requireTenantContext(), propertyId, roomId);
    return "Cleaning started.";
  }, fd);
}

export async function finishCleaningAction(propertyId: string, roomId: string, _p: ActionState, fd: FormData) {
  return run(async () => {
    const r = await finishCleaning(getDb(), await requireTenantContext(), propertyId, roomId, { note: formValues(fd).note });
    return r.requiresInspection ? "Cleaned. Waiting for inspection." : "Cleaned. Room is ready.";
  }, fd);
}

export async function inspectAction(propertyId: string, roomId: string, passed: boolean, _p: ActionState, fd: FormData) {
  return run(async () => {
    await inspectRoom(getDb(), await requireTenantContext(), propertyId, roomId, { passed, note: formValues(fd).note });
    return passed ? "Inspection passed. Room is ready." : "Sent back for cleaning.";
  }, fd);
}

export async function setPolicyAction(propertyId: string, value: boolean, _p: ActionState, fd: FormData) {
  return run(async () => {
    await setRequireInspection(getDb(), await requireTenantContext(), propertyId, value);
    return value ? "Inspection is now required after cleaning." : "Rooms are ready as soon as they are cleaned.";
  }, fd);
}
