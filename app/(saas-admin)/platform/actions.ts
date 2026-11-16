"use server";

import { revalidatePath } from "next/cache";
import { toActionState, type ActionState } from "@/lib/actions";
import { requirePlatformAdmin } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { extendTrial, setTenantStatus } from "@/modules/platform/service";
import { updatePlan } from "@/modules/billing/plans";
import { formValues } from "@/lib/actions";

export async function setTenantStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requirePlatformAdmin();
    await setTenantStatus(getDb(), actor, {
      tenantId: String(formData.get("tenantId") ?? ""),
      status: String(formData.get("status") ?? "") as "active" | "suspended",
      reason: String(formData.get("reason") ?? ""),
    });
  } catch (err) {
    const state = toActionState(err);
    return { ok: false, message: state.fieldErrors?.reason?.[0] ?? state.message };
  }
  revalidatePath("/platform");
  return { ok: true, message: "Status updated." };
}

export async function extendTrialAction(tenantId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requirePlatformAdmin();
    await extendTrial(getDb(), actor, { tenantId, days: String(formData.get("days") ?? ""), reason: String(formData.get("reason") ?? "") });
  } catch (err) {
    const state = toActionState(err);
    return { ok: false, message: Object.values(state.fieldErrors ?? {}).flat()[0] ?? state.message };
  }
  revalidatePath("/platform");
  return { ok: true, message: "Trial extended." };
}

export async function updatePlanAction(planId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = formValues(formData);
  try {
    const actor = await requirePlatformAdmin();
    await updatePlan(getDb(), actor, planId, values as unknown as Parameters<typeof updatePlan>[3]);
  } catch (err) {
    return toActionState(err, values);
  }
  revalidatePath("/platform/plans");
  return { ok: true, message: "Plan saved. Limits apply to every hotel on this plan immediately." };
}
