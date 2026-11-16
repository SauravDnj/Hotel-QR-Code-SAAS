"use server";

import { revalidatePath } from "next/cache";
import { formValues, toActionState, type ActionState } from "@/lib/actions";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { checkIn, checkOut, type CheckInInput } from "@/modules/stays/service";

// propertyId/stayId are bound from the page; the services re-check tenant, property scope,
// permission and room readiness under a row lock.

export async function checkInAction(propertyId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd);
  try {
    await checkIn(getDb(), await requireTenantContext(), propertyId, values as unknown as CheckInInput);
  } catch (err) {
    return toActionState(err, values);
  }
  revalidatePath("/front-desk");
  revalidatePath("/housekeeping");
  return { ok: true, message: `Checked in to room.` };
}

export async function checkOutAction(propertyId: string, stayId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await checkOut(getDb(), await requireTenantContext(), propertyId, stayId, { note: formValues(fd).note });
  } catch (err) {
    return toActionState(err);
  }
  revalidatePath("/front-desk");
  revalidatePath("/housekeeping");
  return { ok: true, message: "Checked out. Housekeeping has a cleaning task." };
}
