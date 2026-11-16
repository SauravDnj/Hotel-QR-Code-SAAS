"use server";

import { revalidatePath } from "next/cache";
import { formValues, toActionState, type ActionState } from "@/lib/actions";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { drainOutboxAfterResponse } from "@/lib/realtime/drain";
import { assignRequest, transitionRequest } from "@/modules/requests/staff";
import { ACTIONS, type StaffAction } from "@/modules/requests/state";

const DONE: Record<StaffAction, string> = {
  acknowledge: "Accepted.",
  start: "Marked in progress.",
  complete: "Completed.",
  cancel: "Cancelled.",
  reopen: "Reopened.",
};

// requestId/action are bound from the page; the service re-checks tenant, property,
// department scope, permission and the state machine before changing anything.
export async function transitionAction(requestId: string, action: StaffAction, _p: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd);
  if (!(action in ACTIONS)) return { ok: false, message: "Unknown action." };
  try {
    await transitionRequest(getDb(), await requireTenantContext(), requestId, action, {
      note: values.note,
      guestMessage: values.guestMessage,
    });
  } catch (err) {
    return toActionState(err, values);
  }
  drainOutboxAfterResponse();
  revalidatePath("/inbox", "layout");
  return { ok: true, message: DONE[action] };
}

export async function assignAction(requestId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd);
  try {
    await assignRequest(getDb(), await requireTenantContext(), requestId, values.userId ?? "");
  } catch (err) {
    return toActionState(err, values);
  }
  drainOutboxAfterResponse();
  revalidatePath("/inbox", "layout");
  return { ok: true, message: "Assigned." };
}
