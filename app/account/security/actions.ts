"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { toActionState, type ActionState } from "@/lib/actions";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { beginMfaEnrollment, confirmMfaEnrollment, disableMfa } from "@/modules/account/security";

export async function beginMfaAction(_p: ActionState, _fd: FormData): Promise<ActionState> {
  void _fd;
  try {
    await beginMfaEnrollment(getDb(), (await requireUser()).id);
  } catch (err) {
    return toActionState(err);
  }
  revalidatePath("/account/security");
  return { ok: true };
}

/** On success every session ends (session_version bump): sign in again with the code. */
export async function confirmMfaAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await confirmMfaEnrollment(getDb(), (await requireUser()).id, String(fd.get("code") ?? ""));
  } catch (err) {
    return toActionState(err);
  }
  await signOut({ redirect: false });
  redirect("/login?mfa=on");
}

export async function disableMfaAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await disableMfa(getDb(), (await requireUser()).id, { password: String(fd.get("password") ?? ""), code: String(fd.get("code") ?? "") });
  } catch (err) {
    return toActionState(err);
  }
  await signOut({ redirect: false });
  redirect("/login");
}
