import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db/client";
import { serverEnv } from "@/lib/env";
import { ablyPublisher } from "@/lib/realtime/ably";
import { drainOutbox } from "@/modules/realtime/outbox";
import { escalateOverdue } from "@/modules/requests/escalation";

/**
 * Outbox sweeper for retries. Vercel Cron (or any scheduler) calls it with
 * `Authorization: Bearer $CRON_SECRET`. Disabled unless CRON_SECRET is set.
 */
export async function GET(request: Request) {
  const secret = serverEnv().CRON_SECRET;
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return new Response("Not found", { status: 404 });
  }
  const escalated = await escalateOverdue(getDb());
  const result = await drainOutbox(getDb(), ablyPublisher(), { limit: 200 });
  return Response.json({ escalated, ...result });
}
