"use server";

import { AuthError } from "next-auth";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { formValues, toActionState, type ActionState } from "@/lib/actions";
import { clientIp } from "@/lib/auth/ip";
import { ACTIVE_TENANT_COOKIE } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { rateLimited } from "@/lib/errors";
import { consumeRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { acceptInvitation } from "@/modules/staff/service";

export async function acceptInviteAction(token: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd);
  let email: string;
  let tenantId: string;
  try {
    const ip = clientIp(await headers());
    // Same budget as sign-in attempts: guessing an existing account's password here is throttled too.
    if (ip && !(await consumeRateLimit(getDb(), `login:ip:${ip}`, RATE_LIMITS.loginByIp)).allowed) throw rateLimited();
    const res = await acceptInvitation(getDb(), token, {
      name: values.name || undefined,
      password: String(fd.get("password") ?? ""),
    });
    email = res.email;
    tenantId = res.tenantId;
  } catch (err) {
    return toActionState(err, values);
  }
  // Open the hotel they just joined.
  (await cookies()).set(ACTIVE_TENANT_COOKIE, tenantId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  try {
    await signIn("credentials", { email, password: String(fd.get("password")), redirectTo: "/inbox" });
  } catch (err) {
    if (err instanceof AuthError) redirect("/login");
    throw err;
  }
  return { ok: true };
}
