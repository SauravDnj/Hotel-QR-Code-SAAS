"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACTIVE_TENANT_COOKIE, requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { listUserTenants } from "@/modules/tenants/context";

export async function selectTenantAction(formData: FormData) {
  const user = await requireUser();
  const tenantId = String(formData.get("tenantId") ?? "");
  // Only tenants the user is an active member of can be selected.
  const allowed = (await listUserTenants(getDb(), user.id)).some((t) => t.tenantId === tenantId);
  if (!allowed) redirect("/select-tenant");
  (await cookies()).set(ACTIVE_TENANT_COOKIE, tenantId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect("/dashboard");
}
