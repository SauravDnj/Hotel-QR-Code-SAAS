"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientIp } from "@/lib/auth/ip";
import { getDb } from "@/lib/db/client";
import { errorFields, logger } from "@/lib/observability/logger";
import { drainOutboxAfterResponse } from "@/lib/realtime/drain";
import { submitGuestRequest } from "@/modules/requests/guest";

export interface GuestFormState {
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  unavailable?: boolean;
}

/**
 * Public guest submission. The QR token bound from the page is the only identity input and
 * is re-resolved on the server; nothing else from the client chooses tenant, room or department.
 */
export async function submitGuestRequestAction(qrToken: string, _prev: GuestFormState, fd: FormData): Promise<GuestFormState> {
  const str = (k: string) => (typeof fd.get(k) === "string" ? (fd.get(k) as string) : undefined);
  let result;
  try {
    result = await submitGuestRequest(
      getDb(),
      qrToken,
      {
        serviceId: str("serviceId") ?? "",
        idempotencyKey: str("idempotencyKey") ?? "",
        quantity: str("quantity"),
        option: str("option"),
        note: str("note"),
      },
      { ip: clientIp(await headers()) },
    );
  } catch (err) {
    // No false success: the guest is told it did not go through.
    logger.error("guest_request_failed", errorFields(err));
    return { message: "We couldn't send your request. Please try again or call reception." };
  }

  if (result.kind === "unavailable") return { unavailable: true, message: "This QR code isn't active. Please contact reception." };
  if (result.kind === "rate_limited") return { message: "Too many requests from this room. Please wait a few minutes or call reception." };
  if (result.kind === "invalid") return { message: result.message, fieldErrors: result.fieldErrors };

  // Publish the realtime notification after responding; the outbox retries if this fails.
  drainOutboxAfterResponse();
  redirect(`/s/${result.statusToken}`);
}
