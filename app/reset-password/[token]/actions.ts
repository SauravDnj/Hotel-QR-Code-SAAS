"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { toActionState, type ActionState } from "@/lib/actions";
import { clientIp } from "@/lib/auth/ip";
import { getDb } from "@/lib/db/client";
import { rateLimited } from "@/lib/errors";
import { consumeRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { resetPassword } from "@/modules/account/security";

export async function resetPasswordAction(token: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ip = clientIp(await headers());
    if (ip && !(await consumeRateLimit(getDb(), `login:ip:${ip}`, RATE_LIMITS.loginByIp)).allowed) throw rateLimited();
    await resetPassword(getDb(), token, String(fd.get("password") ?? ""));
  } catch (err) {
    return toActionState(err);
  }
  redirect("/login?changed=1");
}
