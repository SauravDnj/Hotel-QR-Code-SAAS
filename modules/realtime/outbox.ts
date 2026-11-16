import { eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/types";
import { outboxEvents } from "@/lib/db/schema";
import { departmentChannel, type RequestEvent } from "@/lib/realtime/channels";
import type { RealtimePublisher } from "@/lib/realtime/ably";
import { errorFields, logger } from "@/lib/observability/logger";

/**
 * Transactional outbox (REALTIME_NOTIFICATIONS.md). `enqueueRequestEvent` runs inside the
 * same transaction as the request change, so an event exists iff the change committed.
 * `drainOutbox` publishes afterwards and retries with exponential backoff; a provider outage
 * delays notifications but never loses requests (the inbox reads the database).
 */

export const MAX_ATTEMPTS = 8;
const LEASE_SECONDS = 60;

export async function enqueueRequestEvent(
  tx: Db,
  e: { tenantId: string; propertyId: string; departmentId: string; requestId: string; type: RequestEvent["type"] },
) {
  const payload: RequestEvent = {
    id: crypto.randomUUID(),
    type: e.type,
    occurredAt: new Date().toISOString(),
    propertyId: e.propertyId,
    requestId: e.requestId,
    departmentId: e.departmentId,
    schemaVersion: 1,
  };
  await tx.insert(outboxEvents).values({
    id: payload.id,
    tenantId: e.tenantId,
    eventType: e.type,
    channels: [departmentChannel(e.tenantId, e.propertyId, e.departmentId)],
    payload: { ...payload },
  });
}

/** Backoff: 10s, 20s, 40s … capped at 1h. */
export function backoffSeconds(attempts: number): number {
  return Math.min(3600, 10 * 2 ** Math.max(0, attempts - 1));
}

interface Claimed {
  id: string;
  event_type: string;
  channels: string[];
  payload: Record<string, unknown>;
  attempts: number;
}

/**
 * Claims up to `limit` due events with a short lease (safe across concurrent serverless
 * invocations via SKIP LOCKED), publishes them, and records the outcome.
 */
export async function drainOutbox(db: Db, publisher: RealtimePublisher, opts: { limit?: number } = {}) {
  const limit = opts.limit ?? 25;
  const claimed = (await db.execute(sql`
    update ${outboxEvents} set
      attempts = ${outboxEvents.attempts} + 1,
      next_attempt_at = now() + make_interval(secs => ${LEASE_SECONDS})
    where ${outboxEvents.id} in (
      select id from ${outboxEvents}
      where status = 'pending' and next_attempt_at <= now()
      order by created_at
      limit ${limit}
      for update skip locked
    )
    returning id, event_type, channels, payload, attempts
  `)) as unknown as { rows: Claimed[] } | Claimed[];
  const rows: Claimed[] = Array.isArray(claimed) ? claimed : claimed.rows;

  let published = 0;
  let failed = 0;
  for (const ev of rows) {
    if (!publisher.enabled) {
      // No realtime provider configured: the database inbox (polling) is the delivery path.
      await db.update(outboxEvents).set({ status: "skipped" }).where(eq(outboxEvents.id, ev.id));
      continue;
    }
    try {
      for (const channel of ev.channels) await publisher.publish(channel, ev.event_type, ev.payload);
      await db.update(outboxEvents).set({ status: "published", publishedAt: new Date(), lastError: null }).where(eq(outboxEvents.id, ev.id));
      published++;
    } catch (err) {
      failed++;
      const dead = ev.attempts >= MAX_ATTEMPTS;
      await db
        .update(outboxEvents)
        .set({
          status: dead ? "dead" : "pending",
          lastError: err instanceof Error ? err.message.slice(0, 500) : "publish failed",
          nextAttemptAt: new Date(Date.now() + backoffSeconds(ev.attempts) * 1000),
        })
        .where(eq(outboxEvents.id, ev.id));
      logger[dead ? "error" : "warn"]("outbox_publish_failed", { eventId: ev.id, attempts: ev.attempts, dead, ...errorFields(err) });
    }
  }
  return { claimed: rows.length, published, failed };
}
