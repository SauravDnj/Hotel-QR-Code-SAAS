"use server";

import { revalidatePath } from "next/cache";
import { toActionState, type ActionState } from "@/lib/actions";
import { requirePlatformAdmin } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { setTenantStatus } from "@/modules/platform/service";

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
