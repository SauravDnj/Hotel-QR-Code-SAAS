import { sql } from "drizzle-orm";
import type { Db } from "@/lib/db/types";
import { requestStatusHistory, serviceRequests } from "@/lib/db/schema";
import { enqueueRequestEvent } from "@/modules/realtime/outbox";
import { enqueueNotification } from "@/modules/notifications/service";

/**
 * Escalation (REALTIME_NOTIFICATIONS.md "Escalation"): a request still `new` after the
 * service's target time is flagged once, logged in its history and re-broadcast so managers'
 * inboxes highlight it. Runs from durable triggers (inbox polls and the cron sweeper), never
 * an in-memory timer. Idempotent: each request escalates at most once.
 */
export async function escalateOverdue(db: Db, now: Date = new Date(), limit = 100) {
  return db.transaction(async (tx) => {
    const res = (await tx.execute(sql`
      update ${serviceRequests} set escalated_at = ${now.toISOString()}::timestamptz
      where ${serviceRequests.id} in (
        select id from ${serviceRequests}
        where status = 'new'
          and escalated_at is null
          and escalate_after_minutes is not null
          and submitted_at + make_interval(mins => escalate_after_minutes) <= ${now.toISOString()}::timestamptz
        order by submitted_at
        limit ${limit}
        for update skip locked
      )
      returning id, tenant_id, property_id, department_id, escalate_after_minutes
    `)) as unknown as
      | { rows: Escalated[] }
      | Escalated[];
    const rows: Escalated[] = Array.isArray(res) ? res : res.rows;
    for (const r of rows) {
      await tx.insert(requestStatusHistory).values({
        tenantId: r.tenant_id,
        requestId: r.id,
        fromStatus: "new",
        toStatus: "new",
        source: "system",
        note: `Escalated: not accepted within ${r.escalate_after_minutes} min`,
      });
      await enqueueRequestEvent(tx, {
        tenantId: r.tenant_id,
        propertyId: r.property_id,
        departmentId: r.department_id,
        requestId: r.id,
        type: "service_request.updated",
      });
      await enqueueNotification(tx, {
        tenantId: r.tenant_id,
        propertyId: r.property_id,
        departmentId: r.department_id,
        requestId: r.id,
        kind: "request_escalated",
      });
    }
    return rows.length;
  });
}

interface Escalated {
  id: string;
  tenant_id: string;
  property_id: string;
  department_id: string;
  escalate_after_minutes: number;
}
