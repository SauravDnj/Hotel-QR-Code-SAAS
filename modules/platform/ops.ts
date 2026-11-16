import { count, gte, min, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/types";
import { outboxEvents, paymentWebhookEvents, rateLimits, serviceRequests, subscriptions } from "@/lib/db/schema";
import { forbidden } from "@/lib/errors";
import type { PlatformActor } from "./service";

/**
 * Daily operations dashboard (OPERATIONS_RUNBOOK.md "Daily operations"). Aggregates only:
 * no tenant content, no guest data.
 */
export async function opsHealth(db: Db, actor: PlatformActor, now: Date = new Date()) {
  if (!actor.isPlatformAdmin) throw forbidden();
  const weekAgo = new Date(now.getTime() - 7 * 86400_000);
  const [outbox] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${outboxEvents.status} = 'pending')`.mapWith(Number),
      dead: sql<number>`count(*) filter (where ${outboxEvents.status} = 'dead')`.mapWith(Number),
      retrying: sql<number>`count(*) filter (where ${outboxEvents.status} = 'pending' and ${outboxEvents.attempts} > 0)`.mapWith(Number),
      oldestPending: sql<Date | null>`min(${outboxEvents.createdAt}) filter (where ${outboxEvents.status} = 'pending')`,
    })
    .from(outboxEvents);
  const webhooks = await db
    .select({ status: paymentWebhookEvents.status, n: count(), first: min(paymentWebhookEvents.receivedAt) })
    .from(paymentWebhookEvents)
    .where(gte(paymentWebhookEvents.receivedAt, weekAgo))
    .groupBy(paymentWebhookEvents.status);
  const [requests] = await db
    .select({
      openOverdue: sql<number>`count(*) filter (where ${serviceRequests.status} in ('new','acknowledged','in_progress','reopened') and now() > ${serviceRequests.submittedAt} + make_interval(mins => ${serviceRequests.targetMinutes}))`.mapWith(Number),
      unassignedNew: sql<number>`count(*) filter (where ${serviceRequests.status} = 'new' and ${serviceRequests.assignedUserId} is null)`.mapWith(Number),
      escalated: sql<number>`count(*) filter (where ${serviceRequests.status} = 'new' and ${serviceRequests.escalatedAt} is not null)`.mapWith(Number),
      last24h: sql<number>`count(*) filter (where ${serviceRequests.submittedAt} > now() - interval '24 hours')`.mapWith(Number),
    })
    .from(serviceRequests);
  const subs = await db.select({ status: subscriptions.status, n: count() }).from(subscriptions).groupBy(subscriptions.status);
  const [rl] = await db.select({ n: count() }).from(rateLimits);
  return {
    outbox: {
      ...outbox,
      oldestPendingMinutes: outbox?.oldestPending ? Math.round((now.getTime() - new Date(outbox.oldestPending).getTime()) / 60_000) : null,
    },
    webhooks,
    requests,
    subscriptions: subs,
    rateLimitRows: rl?.n ?? 0,
  };
}
