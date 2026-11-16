"use server";

import { toActionState, type ActionState } from "@/lib/actions";
import { requirePlatformAdmin } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { serverEnv } from "@/lib/env";
import { createPasswordResetLink, operatorResetMfa } from "@/modules/account/security";

export interface LinkState extends ActionState {
  link?: string;
}

const input = (fd: FormData) => ({ email: String(fd.get("email") ?? ""), reason: String(fd.get("reason") ?? "") });

export async function resetLinkAction(_p: LinkState, fd: FormData): Promise<LinkState> {
  try {
    const actor = await requirePlatformAdmin();
    const { token } = await createPasswordResetLink(getDb(), actor, input(fd));
    const base = serverEnv().APP_URL.replace(/\/+$/, "");
    return { ok: true, message: "One-time link (valid 1 hour). Give it to the person privately:", link: `${base}/reset-password/${token}` };
  } catch (err) {
    const s = toActionState(err);
    return { ok: false, message: Object.values(s.fieldErrors ?? {}).flat()[0] ?? s.message };
  }
}

export async function resetMfaAction(_p: LinkState, fd: FormData): Promise<LinkState> {
  try {
    await operatorResetMfa(getDb(), await requirePlatformAdmin(), input(fd));
    return { ok: true, message: "Two-step sign-in reset. They can sign in with their password and set it up again." };
  } catch (err) {
    const s = toActionState(err);
    return { ok: false, message: Object.values(s.fieldErrors ?? {}).flat()[0] ?? s.message };
  }
}
