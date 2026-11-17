"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { serverEnv } from "@/lib/env";
import { SUPPORT_TENANT_COOKIE } from "@/lib/auth/session";
import { encodeSupportCookie, SUPPORT_SESSION_MINUTES } from "@/lib/auth/support-cookie";
import {
  activateManually,
  changeTenantPlan,
  createTenantAsOperator,
  setMembershipStatusAsOperator,
  setPlatformAdmin,
  setUserStatus,
  startSupportSession,
  updateTenantProfile,
} from "@/modules/platform/admin";
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

// ---------------------------------------------------------------- super admin console

export interface CreateHotelState extends ActionState {
  link?: string;
  tenantId?: string;
}

const fail = (err: unknown, values?: Record<string, string>): ActionState => {
  const s = toActionState(err, values);
  return { ...s, message: s.fieldErrors ? (Object.values(s.fieldErrors).flat()[0] ?? s.message) : s.message };
};

export async function createHotelAction(_prev: CreateHotelState, formData: FormData): Promise<CreateHotelState> {
  const values = formValues(formData);
  try {
    const actor = await requirePlatformAdmin();
    const created = await createTenantAsOperator(getDb(), actor, values as never);
    revalidatePath("/platform", "layout");
    const base = serverEnv().APP_URL.replace(/\/+$/, "");
    return {
      ok: true,
      message: "Hotel created. Send this one-time link (valid 1 hour) to the owner so they choose their password:",
      link: `${base}/reset-password/${created.token}`,
      tenantId: created.tenantId,
    };
  } catch (err) {
    return toActionState(err, values);
  }
}

export async function updateTenantProfileAction(tenantId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = formValues(formData);
  try {
    await updateTenantProfile(getDb(), await requirePlatformAdmin(), tenantId, values as never);
  } catch (err) {
    return fail(err, values);
  }
  revalidatePath(`/platform/tenants/${tenantId}`);
  return { ok: true, message: "Hotel details saved." };
}

export async function changePlanAction(tenantId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await changeTenantPlan(getDb(), await requirePlatformAdmin(), tenantId, {
      planId: String(formData.get("planId") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
  } catch (err) {
    return fail(err);
  }
  revalidatePath(`/platform/tenants/${tenantId}`);
  return { ok: true, message: "Plan changed. New limits apply now." };
}

export async function activateAction(tenantId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await activateManually(getDb(), await requirePlatformAdmin(), tenantId, {
      days: String(formData.get("days") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
  } catch (err) {
    return fail(err);
  }
  revalidatePath(`/platform/tenants/${tenantId}`);
  return { ok: true, message: "Subscription marked as paid." };
}

export async function memberStatusAction(tenantId: string, membershipId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await setMembershipStatusAsOperator(getDb(), await requirePlatformAdmin(), tenantId, membershipId, {
      status: String(formData.get("status") ?? "") as "active" | "disabled",
      reason: String(formData.get("reason") ?? ""),
    });
  } catch (err) {
    return fail(err);
  }
  revalidatePath(`/platform/tenants/${tenantId}`);
  return { ok: true, message: "Access updated." };
}

export async function userStatusAction(userId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await setUserStatus(getDb(), await requirePlatformAdmin(), userId, {
      status: String(formData.get("status") ?? "") as "active" | "disabled",
      reason: String(formData.get("reason") ?? ""),
    });
  } catch (err) {
    return fail(err);
  }
  revalidatePath("/platform", "layout");
  return { ok: true, message: "Login updated." };
}

export async function platformAdminAction(userId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await setPlatformAdmin(getDb(), await requirePlatformAdmin(), userId, {
      grant: formData.get("grant") === "1",
      reason: String(formData.get("reason") ?? ""),
    });
  } catch (err) {
    return fail(err);
  }
  revalidatePath("/platform", "layout");
  return { ok: true, message: "Super admin access updated." };
}

/** Opens the hotel's own screens for 1 hour: read-only ("view") or as hotel admin ("full"). Audited. */
export async function startSupportAction(tenantId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  let mode: "view" | "full";
  try {
    mode = await startSupportSession(getDb(), await requirePlatformAdmin(), tenantId, {
      reason: String(formData.get("reason") ?? ""),
      mode: formData.get("mode") === "full" ? "full" : "view",
    });
  } catch (err) {
    return fail(err);
  }
  (await cookies()).set(SUPPORT_TENANT_COOKIE, encodeSupportCookie(tenantId, mode), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SUPPORT_SESSION_MINUTES * 60,
  });
  redirect("/dashboard");
}

export async function exitSupportAction(tenantId: string) {
  await requirePlatformAdmin();
  (await cookies()).delete(SUPPORT_TENANT_COOKIE);
  redirect(`/platform/tenants/${tenantId}`);
}
