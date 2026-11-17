import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db/client";
import { serverEnv } from "@/lib/env";
import { ablyPublisher } from "@/lib/realtime/ably";
import { sweepSubscriptions } from "@/modules/billing/subscription";
import { drainOutbox } from "@/modules/realtime/outbox";
import { escalateOverdue } from "@/modules/requests/escalation";
import { applyRetention } from "@/modules/privacy/retention";
import { sweepNoShows } from "@/modules/reservations/service";
import { outboxNotifier } from "@/lib/realtime/drain";

/**
 * Daily maintenance (vercel.json cron): subscription lifecycle (trial end → grace →
 * suspension), escalation, night-audit no-shows, outbox retries and data retention (guest PII, rate-limit rows). Vercel sends `Authorization: Bearer
 * $CRON_SECRET`; without the secret the route is disabled (404).
 */
export async function GET(request: Request) {
  const secret = serverEnv().CRON_SECRET;
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return new Response("Not found", { status: 404 });
  }
  const db = getDb();
  const billing = await sweepSubscriptions(db);
  const escalated = await escalateOverdue(db);
  const noShows = await sweepNoShows(db);
  const outbox = await drainOutbox(db, ablyPublisher(), { limit: 500, notifier: outboxNotifier() });
  const retention = await applyRetention(db);
  return Response.json({ billing, escalated, noShows, outbox, retention });
}
