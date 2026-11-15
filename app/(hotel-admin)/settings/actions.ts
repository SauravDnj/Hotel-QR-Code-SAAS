"use server";

import { revalidatePath } from "next/cache";
import { formValues, toActionState, type ActionState } from "@/lib/actions";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { updateTenantSettings, type TenantSettingsInput } from "@/modules/tenants/settings";

export async function updateTenantSettingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = formValues(formData);
  try {
    const ctx = await requireTenantContext();
    await updateTenantSettings(getDb(), ctx, values as unknown as TenantSettingsInput);
  } catch (err) {
    return toActionState(err, values);
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Settings saved.", values };
}
