"use server";

import { revalidatePath } from "next/cache";
import { formValues, toActionState, type ActionState } from "@/lib/actions";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { archiveService, createDefaultServices, createService, updateService, type ServiceInput } from "@/modules/services/catalog";

async function run(propertyId: string, fd: FormData, fn: (values: Record<string, string>) => Promise<string>): Promise<ActionState> {
  const values = formValues(fd);
  let message: string;
  try {
    message = await fn(values);
  } catch (err) {
    return toActionState(err, values);
  }
  revalidatePath(`/properties/${propertyId}`, "layout");
  return { ok: true, message };
}

const ctx = () => requireTenantContext();

export async function createDefaultServicesAction(propertyId: string, _p: ActionState, fd: FormData) {
  return run(propertyId, fd, async () => {
    const { count } = await createDefaultServices(getDb(), await ctx(), propertyId);
    return count === 0 ? "Standard services are already set up." : `${count} services added.`;
  });
}

export async function createServiceAction(propertyId: string, _p: ActionState, fd: FormData) {
  return run(propertyId, fd, async (v) => {
    await createService(getDb(), await ctx(), propertyId, v as unknown as ServiceInput);
    return "Service added.";
  });
}

export async function updateServiceAction(propertyId: string, serviceId: string, _p: ActionState, fd: FormData) {
  return run(propertyId, fd, async (v) => {
    await updateService(getDb(), await ctx(), propertyId, serviceId, v as unknown as ServiceInput);
    return "Saved.";
  });
}

export async function archiveServiceAction(propertyId: string, serviceId: string, _p: ActionState, fd: FormData) {
  return run(propertyId, fd, async () => {
    await archiveService(getDb(), await ctx(), propertyId, serviceId);
    return "Service removed.";
  });
}
