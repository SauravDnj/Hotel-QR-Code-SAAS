"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formValues, toActionState, type ActionState } from "@/lib/actions";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { createProperty, updateProperty, type PropertyInput } from "@/modules/properties/service";

// Server actions are public HTTP endpoints: each one rebuilds the tenant context and
// the service layer re-authorises. Nothing here trusts a tenant id from the form.

export async function createPropertyAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = formValues(formData);
  let id: string;
  try {
    const ctx = await requireTenantContext();
    id = (await createProperty(getDb(), ctx, values as unknown as PropertyInput)).id;
  } catch (err) {
    return toActionState(err, values);
  }
  revalidatePath("/properties");
  redirect(`/properties/${id}?saved=1`);
}

export async function updatePropertyAction(
  propertyId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  try {
    const ctx = await requireTenantContext();
    await updateProperty(getDb(), ctx, propertyId, values as unknown as PropertyInput);
  } catch (err) {
    return toActionState(err, values);
  }
  revalidatePath("/properties");
  revalidatePath(`/properties/${propertyId}`);
  return { ok: true, message: "Property saved.", values };
}
