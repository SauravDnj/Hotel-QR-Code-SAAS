"use server";

import { redirect } from "next/navigation";
import { toActionState, type ActionState } from "@/lib/actions";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { startCheckout } from "@/modules/billing/service";

/** Only the plan id comes from the form; price and plan details are read on the server. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- useActionState signature
export async function choosePlanAction(planId: string, _p: ActionState, _fd: FormData): Promise<ActionState> {
  let url: string;
  try {
    ({ url } = await startCheckout(getDb(), await requireTenantContext(), planId));
  } catch (err) {
    return toActionState(err);
  }
  redirect(url);
}
