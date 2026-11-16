import { getCurrentUser, requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { drainOutboxAfterResponse } from "@/lib/realtime/drain";
import { inboxMarker } from "@/modules/requests/staff";

/**
 * Change marker for the staff inbox: the newest update time and the count of new requests
 * in the caller's scope. Clients poll it (fallback / missed-event recovery) and refresh the
 * page when it changes. Contains no request details.
 */
export async function GET() {
  if (!(await getCurrentUser())) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const ctx = await requireTenantContext();
  const marker = await inboxMarker(getDb(), ctx);
  // Polls double as the outbox's heartbeat, so no frequent cron is required.
  drainOutboxAfterResponse(25);
  return Response.json(marker, { headers: { "Cache-Control": "private, no-store" } });
}
