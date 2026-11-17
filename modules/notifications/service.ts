import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/types";
import { departments, outboxEvents, pushSubscriptions, serviceRequests, tenantMemberships, users } from "@/lib/db/schema";
import { serverEnv } from "@/lib/env";
import { notFound } from "@/lib/errors";
import { can, type TenantContext } from "@/lib/permissions/authorize";
import { departmentScope, inDepartmentScope } from "@/lib/permissions/departments";
import type { NotificationSenders } from "@/lib/notifications/senders";
import { errorFields, logger } from "@/lib/observability/logger";
import { loadTenantContext } from "@/modules/tenants/context";

/**
 * Staff alerts beyond the open inbox (Phase 9, REALTIME_NOTIFICATIONS.md "Browser push is
 * optional … Email/SMS can be configured as escalation channels, not the only primary
 * workflow").
 * - New request → Web Push to staff whose role covers the department (and who want alerts
 *   for all requests).
 * - Escalation → Web Push + SMS/WhatsApp to supervisors (request.assign) of that department.
 * Jobs ride the transactional outbox (same retry/backoff); recipients are re-derived from
 * current roles at delivery time, so a removed staff member gets nothing.
 */

export type NotifyKind = "request_new" | "request_escalated";

/** Notification jobs are only written when at least one channel is configured. */
export function notificationsConfigured(): boolean {
  const env = serverEnv();
  return Boolean((env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) || (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN));
}

export async function enqueueNotification(
  tx: Db,
  e: { tenantId: string; propertyId: string; departmentId: string; requestId: string; kind: NotifyKind },
  opts: { force?: boolean } = {},
) {
  if (!opts.force && !notificationsConfigured()) return;
  await tx.insert(outboxEvents).values({
    tenantId: e.tenantId,
    eventType: `notify.${e.kind}`,
    channels: [],
    payload: { kind: e.kind, requestId: e.requestId, propertyId: e.propertyId, departmentId: e.departmentId, schemaVersion: 1 },
  });
}

const payloadSchema = z.object({
  kind: z.enum(["request_new", "request_escalated"]),
  requestId: z.uuid(),
  propertyId: z.uuid(),
  departmentId: z.uuid(),
});

export interface DeliveryResult {
  recipients: number;
  pushed: number;
  removed: number;
  messaged: number;
  skippedReason?: string;
}

export async function deliverNotification(db: Db, tenantId: string, raw: unknown, senders: NotificationSenders): Promise<DeliveryResult> {
  const p = payloadSchema.parse(raw);
  const result: DeliveryResult = { recipients: 0, pushed: 0, removed: 0, messaged: 0 };
  const [r] = await db
    .select({
      id: serviceRequests.id,
      status: serviceRequests.status,
      roomCode: serviceRequests.roomCode,
      serviceName: serviceRequests.serviceName,
      escalateAfterMinutes: serviceRequests.escalateAfterMinutes,
      targetMinutes: serviceRequests.targetMinutes,
      departmentKey: departments.key,
    })
    .from(serviceRequests)
    .innerJoin(departments, eq(departments.id, serviceRequests.departmentId))
    .where(and(eq(serviceRequests.id, p.requestId), eq(serviceRequests.tenantId, tenantId)));
  // Already accepted by the time we deliver: nobody needs to be disturbed.
  if (!r || r.status !== "new") return { ...result, skippedReason: "not_new" };

  const members = await db
    .select({
      membershipId: tenantMemberships.id,
      userId: tenantMemberships.userId,
      notifyScope: tenantMemberships.notifyScope,
      notifyPush: tenantMemberships.notifyPush,
      alertPhone: tenantMemberships.alertPhone,
      escalationChannel: tenantMemberships.escalationChannel,
    })
    .from(tenantMemberships)
    .innerJoin(users, eq(users.id, tenantMemberships.userId))
    .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.status, "active"), eq(users.status, "active")))
    .limit(500);

  const escalation = p.kind === "request_escalated";
  const minutes = r.escalateAfterMinutes ?? r.targetMinutes;
  const url = `/inbox/${r.id}`;
  const payload = escalation
    ? { title: `Escalated: room ${r.roomCode}`, body: `${r.serviceName}, not accepted in ${minutes} min`, url, tag: `esc-${r.id}` }
    : { title: `Room ${r.roomCode}: ${r.serviceName}`, body: "New guest request", url, tag: `req-${r.id}` };

  for (const m of members) {
    const mctx = await loadTenantContext(db, m.userId, tenantId);
    if (!mctx) continue;
    if (!inDepartmentScope(departmentScope(mctx, "request.view", p.propertyId), { id: p.departmentId, key: r.departmentKey })) continue;
    if (escalation ? !can(mctx, "request.assign", { propertyId: p.propertyId }) : m.notifyScope === "mine") continue;
    result.recipients++;

    if (senders.push && m.notifyPush) {
      const subs = await db.select().from(pushSubscriptions).where(and(eq(pushSubscriptions.tenantId, tenantId), eq(pushSubscriptions.membershipId, m.membershipId)));
      for (const s of subs) {
        try {
          const outcome = await senders.push(s, payload);
          if (outcome === "gone") {
            await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
            result.removed++;
          } else {
            await db.update(pushSubscriptions).set({ failures: 0, lastSuccessAt: new Date() }).where(eq(pushSubscriptions.id, s.id));
            result.pushed++;
          }
        } catch (err) {
          // One bad device never blocks the others; persistent failures are pruned.
          await db
            .update(pushSubscriptions)
            .set({ failures: sql`${pushSubscriptions.failures} + 1` })
            .where(eq(pushSubscriptions.id, s.id));
          await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.id, s.id), sql`${pushSubscriptions.failures} >= 10`));
          logger.warn("push_delivery_failed", { subscriptionId: s.id, ...errorFields(err) });
        }
      }
    }

    if (escalation && senders.message && m.alertPhone && (m.escalationChannel === "sms" || m.escalationChannel === "whatsapp")) {
      try {
        await senders.message(m.escalationChannel, m.alertPhone, { room: r.roomCode, service: r.serviceName, minutes, url: absolute(url) });
        result.messaged++;
      } catch (err) {
        logger.warn("escalation_message_failed", { membershipId: m.membershipId, channel: m.escalationChannel, ...errorFields(err) });
      }
    }
  }
  return result;
}

function absolute(path: string) {
  try {
    return new URL(path, serverEnv().APP_URL).toString();
  } catch {
    return path;
  }
}

// ---------------------------------------------------------------- staff self-service

const subscriptionSchema = z.object({
  endpoint: z
    .url()
    .max(1000)
    .refine((u) => u.startsWith("https://"), "Push endpoints must be https"),
  keys: z.object({ p256dh: z.string().min(40).max(200), auth: z.string().min(8).max(100) }),
});

/** Short label from a user agent ("Chrome on Android"); the full UA is not stored. */
export function deviceLabel(ua: string | null): string {
  if (!ua) return "This device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

export async function savePushSubscription(db: Db, ctx: TenantContext, raw: unknown, userAgent: string | null) {
  const sub = subscriptionSchema.parse(raw);
  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.membershipId, ctx.membershipId));
  if (count.n >= 10) {
    // Keep the newest devices only.
    await db.execute(sql`delete from ${pushSubscriptions} where id in (
      select id from ${pushSubscriptions} where membership_id = ${ctx.membershipId} order by created_at asc limit 1)`);
  }
  await db
    .insert(pushSubscriptions)
    .values({
      tenantId: ctx.tenantId,
      membershipId: ctx.membershipId,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      label: deviceLabel(userAgent),
    })
    .onConflictDoUpdate({
      target: [pushSubscriptions.membershipId, pushSubscriptions.endpoint],
      set: { p256dh: sub.keys.p256dh, auth: sub.keys.auth, failures: 0 },
    });
}

export async function removePushSubscription(db: Db, ctx: TenantContext, endpoint: string) {
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.membershipId, ctx.membershipId), eq(pushSubscriptions.tenantId, ctx.tenantId), eq(pushSubscriptions.endpoint, endpoint)));
}

export async function listMyDevices(db: Db, ctx: TenantContext) {
  return db
    .select({ id: pushSubscriptions.id, label: pushSubscriptions.label, createdAt: pushSubscriptions.createdAt, lastSuccessAt: pushSubscriptions.lastSuccessAt })
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.membershipId, ctx.membershipId), eq(pushSubscriptions.tenantId, ctx.tenantId)));
}

export async function removeDevice(db: Db, ctx: TenantContext, id: string) {
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) throw notFound("Device not found.");
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.id, parsed.data), eq(pushSubscriptions.membershipId, ctx.membershipId), eq(pushSubscriptions.tenantId, ctx.tenantId)));
}

/** "Send a test" from the profile page: direct, not via the outbox. */
export async function sendTestPush(db: Db, ctx: TenantContext, senders: NotificationSenders) {
  if (!senders.push) return { sent: 0, configured: false };
  const subs = await db.select().from(pushSubscriptions).where(and(eq(pushSubscriptions.membershipId, ctx.membershipId), eq(pushSubscriptions.tenantId, ctx.tenantId)));
  let sent = 0;
  for (const s of subs) {
    const outcome = await senders.push(s, { title: "Test notification", body: "Notifications work on this device.", url: "/inbox", tag: "test" }).catch(() => "error" as const);
    if (outcome === "gone") await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
    if (outcome === "ok") sent++;
  }
  return { sent, configured: true };
}
