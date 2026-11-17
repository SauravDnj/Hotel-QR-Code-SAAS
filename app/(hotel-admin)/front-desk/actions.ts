"use server";

import { revalidatePath } from "next/cache";
import { formValues, toActionState, type ActionState } from "@/lib/actions";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { checkIn, checkOut, type CheckInInput } from "@/modules/stays/service";
import { addCharge, recordPayment, voidCharge } from "@/modules/ordering/folio";

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
    const v = formValues(fd);
    await checkOut(getDb(), await requireTenantContext(), propertyId, stayId, { note: v.note, allowBalance: v.allowBalance });
  } catch (err) {
    return toActionState(err);
  }
  revalidatePath("/front-desk");
  revalidatePath("/housekeeping");
  return { ok: true, message: "Checked out. Housekeeping has a cleaning task." };
}

async function folioRun(fd: FormData, fn: (v: Record<string, string>) => Promise<string>): Promise<ActionState> {
  const values = formValues(fd);
  let message: string;
  try {
    message = await fn(values);
  } catch (err) {
    return toActionState(err, values);
  }
  revalidatePath("/front-desk", "layout");
  return { ok: true, message };
}

export async function addChargeAction(propertyId: string, stayId: string, _p: ActionState, fd: FormData) {
  return folioRun(fd, async (v) => {
    await addCharge(getDb(), await requireTenantContext(), propertyId, stayId, { description: v.description ?? "", amount: v.amount ?? "" });
    return "Charge added.";
  });
}

export async function recordPaymentAction(propertyId: string, stayId: string, _p: ActionState, fd: FormData) {
  return folioRun(fd, async (v) => {
    await recordPayment(getDb(), await requireTenantContext(), propertyId, stayId, { amount: v.amount ?? "", method: v.method ?? "", reference: v.reference });
    return "Payment recorded.";
  });
}

export async function voidChargeAction(propertyId: string, chargeId: string, _p: ActionState, fd: FormData) {
  return folioRun(fd, async (v) => {
    await voidCharge(getDb(), await requireTenantContext(), propertyId, chargeId, { reason: v.reason });
    return "Charge voided.";
  });
}
