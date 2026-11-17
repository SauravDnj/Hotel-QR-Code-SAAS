"use server";

import { AuthError } from "next-auth";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/auth";
import { formValues, toActionState, type ActionState } from "@/lib/actions";
import { clientIp } from "@/lib/auth/ip";
import { SUPPORT_TENANT_COOKIE } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { rateLimited } from "@/lib/errors";
import { logger } from "@/lib/observability/logger";
import { consumeRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { createTenantWithOwner, signupSchema } from "@/modules/tenants/onboarding";

/** Only allow same-site relative redirects after login (no open redirect). */
function safeNext(value: FormDataEntryValue | null): string {
  const v = typeof value === "string" ? value : "";
  return v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : "/";
}

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get("email") ?? "");
  try {
    await signIn("credentials", {
      email,
      password: String(formData.get("password") ?? ""),
      otp: String(formData.get("otp") ?? ""),
      redirectTo: safeNext(formData.get("next")),
    });
  } catch (err) {
    if (err instanceof AuthError) {
      const code = (err as AuthError & { code?: string }).code;
      const mfa = code === "mfa_required" || Boolean(formData.get("otp"));
      return {
        ok: false,
        message:
          code === "rate_limited"
            ? "Too many sign-in attempts. Please wait 15 minutes and try again."
            : code === "mfa_required"
              ? "Enter your password again with the 6-digit code from your authenticator app."
              : mfa
                ? "Incorrect email, password or authenticator code."
                : "Incorrect email or password.",
        values: { email, ...(mfa ? { mfa: "1" } : {}) },
      };
    }
    throw err; // includes Next.js redirect signal on success
  }
  return { ok: true };
}

export async function signupAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = formValues(formData);
  let email: string;
  try {
    const ip = clientIp(await headers());
    if (ip && !(await consumeRateLimit(getDb(), `signup:ip:${ip}`, RATE_LIMITS.signupByIp)).allowed) {
      throw rateLimited();
    }
    const input = signupSchema.parse(Object.fromEntries(formData));
    const created = await createTenantWithOwner(getDb(), input);
    logger.info("tenant_signup", { tenantId: created.tenantId });
    email = input.email;
  } catch (err) {
    return toActionState(err, values);
  }
  try {
    await signIn("credentials", { email, password: String(formData.get("password")), redirectTo: "/dashboard" });
  } catch (err) {
    if (err instanceof AuthError) redirect("/login");
    throw err;
  }
  return { ok: true };
}

export async function logoutAction() {
  (await cookies()).delete(SUPPORT_TENANT_COOKIE);
  await signOut({ redirectTo: "/login" });
}
