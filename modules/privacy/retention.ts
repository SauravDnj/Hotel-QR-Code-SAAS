import { and, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/types";
import { guests, outboxEvents, rateLimits, requestFeedback, reservations, serviceRequests, stays } from "@/lib/db/schema";

/**
 * Data retention (SECURITY_PRIVACY.md "Minimize guest PII; define retention and deletion").
 * Policy (documented in docs/RUNBOOK.md):
 * - Guest name/phone/email are anonymised GUEST_RETENTION_DAYS after their last checkout or
 *   booking departure date
 *   (stay records and occupancy statistics are kept).
 * - Guest-typed request notes and feedback comments are cleared after the same period (they
 *   may contain PII); star ratings are kept.
 * - Rate-limit counters older than 2 days are deleted.
 * Runs from the daily cron; idempotent.
 */
export const GUEST_RETENTION_DAYS = 180;
export const ANONYMISED_NAME = "Former guest";

export async function applyRetention(db: Db, now: Date = new Date()) {
  const cutoff = new Date(now.getTime() - GUEST_RETENTION_DAYS * 86400_000);
  const anonymised = await db
    .update(guests)
    .set({ name: ANONYMISED_NAME, phone: null, email: null })
    .where(
      and(
        ne(guests.name, ANONYMISED_NAME),
        // No stay still in house, and the latest checkout is older than the cutoff.
        sql`not exists (select 1 from ${stays} s where s.guest_id = ${guests.id} and (s.status = 'checked_in' or s.checked_out_at >= ${cutoff.toISOString()}::timestamptz))`,
        // Bookings (Phase 9): none still open, and none departing within the retention period.
        sql`not exists (select 1 from ${reservations} r where r.guest_id = ${guests.id} and (r.status in ('confirmed', 'checked_in') or r.departure_date >= ${cutoff.toISOString().slice(0, 10)}::date))`,
        sql`(exists (select 1 from ${stays} s where s.guest_id = ${guests.id}) or exists (select 1 from ${reservations} r where r.guest_id = ${guests.id}))`,
      ),
    )
    .returning({ id: guests.id });
  const notes = await db
    .update(serviceRequests)
    .set({ guestNote: null })
    .where(and(isNotNull(serviceRequests.guestNote), lt(serviceRequests.submittedAt, cutoff)))
    .returning({ id: serviceRequests.id });
  const comments = await db
    .update(requestFeedback)
    .set({ comment: null })
    .where(and(isNotNull(requestFeedback.comment), lt(requestFeedback.createdAt, cutoff)))
    .returning({ id: requestFeedback.id });
  const limits = await db
    .delete(rateLimits)
    .where(lt(rateLimits.windowStart, new Date(now.getTime() - 2 * 86400_000)))
    .returning({ key: rateLimits.key });
  // Delivered/finished outbox jobs are only useful for short-term debugging.
  const outbox = await db
    .delete(outboxEvents)
    .where(and(inArray(outboxEvents.status, ["published", "skipped"]), lt(outboxEvents.createdAt, new Date(now.getTime() - 30 * 86400_000))))
    .returning({ id: outboxEvents.id });
  return {
    guestsAnonymised: anonymised.length,
    notesCleared: notes.length,
    feedbackCommentsCleared: comments.length,
    rateLimitRowsDeleted: limits.length,
    outboxRowsDeleted: outbox.length,
  };
}
