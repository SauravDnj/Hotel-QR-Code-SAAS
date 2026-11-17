"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { clientIp } from "@/lib/auth/ip";
import { getDb } from "@/lib/db/client";
import { errorFields, logger } from "@/lib/observability/logger";
import { submitGuestFeedback } from "@/modules/requests/feedback";

export interface RateState {
  ok?: boolean;
  message?: string;
}

/** Public: the status token bound from the page is the only identity input. */
export async function rateRequestAction(token: string, _prev: RateState, fd: FormData): Promise<RateState> {
  let res;
  try {
    res = await submitGuestFeedback(
      getDb(),
      token,
      { rating: fd.get("rating") ?? "", comment: typeof fd.get("comment") === "string" ? fd.get("comment") : undefined },
      { ip: clientIp(await headers()) },
    );
  } catch (err) {
    logger.error("guest_feedback_failed", errorFields(err));
    return { message: "We couldn't save your rating. Please try again." };
  }
  switch (res.kind) {
    case "ok":
      revalidatePath(`/s/${token}`);
      return { ok: true, message: "Thank you for your feedback!" };
    case "already_rated":
      revalidatePath(`/s/${token}`);
      return { ok: true, message: "You've already rated this request. Thank you!" };
    case "not_completed":
      return { message: "You can rate this once it's completed." };
    case "rate_limited":
      return { message: "Please wait a moment and try again." };
    case "invalid":
      return { message: res.message };
    default:
      return { message: "This link is no longer active." };
  }
}
