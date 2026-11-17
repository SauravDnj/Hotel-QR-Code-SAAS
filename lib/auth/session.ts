import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import type { TenantContext } from "@/lib/permissions/authorize";
import { listUserTenants, loadSupportContext, loadTenantContext } from "@/modules/tenants/context";
import type { PlatformActor } from "@/modules/platform/service";

export const ACTIVE_TENANT_COOKIE = "active_tenant";
/** Hotel a SaaS operator is viewing in read-only support mode (set by an audited action, 1 h). */
export const SUPPORT_TENANT_COOKIE = "support_tenant";

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  isPlatformAdmin: boolean;
  mfaEnabled: boolean;
}

/**
 * Signed-in user, re-validated against the database on every request: a disabled user
 * or a bumped session_version invalidates the cookie session immediately.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  const [user] = await getDb().select().from(users).where(eq(users.id, userId));
  if (!user || user.status !== "active" || user.sessionVersion !== session.sv) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isPlatformAdmin: user.isPlatformAdmin,
    mfaEnabled: Boolean(user.mfaEnabledAt),
  };
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Tenant context for staff/admin pages and actions. The tenant comes from the user's
 * memberships; the cookie only selects between tenants the user already belongs to.
 */
export const requireTenantContext = cache(async (): Promise<TenantContext> => {
  const user = await requireUser();
  const jar = await cookies();
  const support = jar.get(SUPPORT_TENANT_COOKIE)?.value;
  // Support view: only honoured for operators with two-step sign-in; the cookie names a hotel
  // the operator could already see in the console, so forging it grants nothing new.
  if (support && user.isPlatformAdmin && user.mfaEnabled && /^[0-9a-f-]{36}$/i.test(support)) {
    const ctx = await loadSupportContext(getDb(), user.id, support);
    if (ctx) return ctx;
  }
  const memberships = await listUserTenants(getDb(), user.id);
  if (memberships.length === 0) redirect(user.isPlatformAdmin ? "/platform" : "/no-access");

  const selected = jar.get(ACTIVE_TENANT_COOKIE)?.value;
  const chosen =
    memberships.find((m) => m.tenantId === selected) ?? (memberships.length === 1 ? memberships[0] : undefined);
  if (!chosen) redirect("/select-tenant");

  const ctx = await loadTenantContext(getDb(), user.id, chosen.tenantId);
  if (!ctx) redirect("/select-tenant");
  return ctx;
});

export async function requirePlatformAdmin(): Promise<PlatformActor & CurrentUser> {
  const user = await requireUser();
  // 404 rather than 403 so the operator console is not discoverable.
  if (!user.isPlatformAdmin) notFound();
  // SECURITY_PRIVACY.md: MFA is required for SaaS operators. Sessions are re-issued with the
  // code once enabled (session_version bump), so this also covers sessions from before.
  if (!user.mfaEnabled) redirect("/account/security?required=1");
  return { ...user, userId: user.id };
}
