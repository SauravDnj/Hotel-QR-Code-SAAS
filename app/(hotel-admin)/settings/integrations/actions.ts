"use server";

import { revalidatePath } from "next/cache";
import { formValues, toActionState, type ActionState } from "@/lib/actions";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { createApiKey, revokeApiKey, type ApiScope } from "@/modules/integrations/keys";
import { createWebhook, deleteWebhook, sendTestWebhook, setWebhookActive, type WebhookEvent } from "@/modules/integrations/webhooks";

export interface SecretState extends ActionState {
  /** Shown exactly once, right after creation. */
  secret?: string;
}

const refresh = () => revalidatePath("/settings/integrations");

export async function createApiKeyAction(_p: SecretState, fd: FormData): Promise<SecretState> {
  const values = formValues(fd);
  try {
    const { secret } = await createApiKey(getDb(), await requireTenantContext(), {
      name: values.name ?? "",
      propertyId: values.propertyId ?? "",
      scopes: fd.getAll("scopes").map(String) as ApiScope[],
    });
    refresh();
    return { ok: true, message: "Key created. Copy it now: it won't be shown again.", secret };
  } catch (err) {
    return toActionState(err, values);
  }
}

export async function revokeApiKeyAction(id: string): Promise<ActionState> {
  try {
    await revokeApiKey(getDb(), await requireTenantContext(), id);
  } catch (err) {
    return toActionState(err);
  }
  refresh();
  return { ok: true, message: "Key revoked." };
}

export async function createWebhookAction(_p: SecretState, fd: FormData): Promise<SecretState> {
  const values = formValues(fd);
  try {
    const { secret } = await createWebhook(getDb(), await requireTenantContext(), {
      url: values.url ?? "",
      description: values.description,
      events: fd.getAll("events").map(String) as WebhookEvent[],
    });
    refresh();
    return { ok: true, message: "Webhook added. Copy the signing secret now: it won't be shown again.", secret };
  } catch (err) {
    return toActionState(err, values);
  }
}

export async function toggleWebhookAction(id: string, active: boolean): Promise<ActionState> {
  try {
    await setWebhookActive(getDb(), await requireTenantContext(), id, active);
  } catch (err) {
    return toActionState(err);
  }
  refresh();
  return { ok: true, message: active ? "Webhook enabled." : "Webhook paused." };
}

export async function deleteWebhookAction(id: string): Promise<ActionState> {
  try {
    await deleteWebhook(getDb(), await requireTenantContext(), id);
  } catch (err) {
    return toActionState(err);
  }
  refresh();
  return { ok: true, message: "Webhook deleted." };
}

export async function testWebhookAction(id: string): Promise<ActionState> {
  try {
    const res = await sendTestWebhook(getDb(), await requireTenantContext(), id);
    refresh();
    return res.skipped ? { ok: false, message: "This webhook is paused." } : { ok: true, message: `Delivered (HTTP ${res.status}).` };
  } catch (err) {
    refresh();
    if (err instanceof Error && !("code" in err)) return { ok: false, message: `Delivery failed: ${err.message}` };
    return toActionState(err);
  }
}
