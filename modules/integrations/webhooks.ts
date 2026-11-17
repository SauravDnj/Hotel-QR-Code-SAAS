import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/types";
import { outboxEvents, webhookEndpoints } from "@/lib/db/schema";
import { decryptSecret, encryptSecret, generateQrToken } from "@/lib/crypto/secrets";
import { conflict, notFound } from "@/lib/errors";
import { assertTenantWritable, authorize, type TenantContext } from "@/lib/permissions/authorize";
import { optionalText } from "@/lib/validation/common";
import { writeAudit } from "@/modules/audit/service";
import { assertModule } from "@/modules/billing/subscription";

/**
 * Outbound webhooks (Phase 9). Events are THIN: identifiers, codes, dates and room codes —
 * never guest names, contact details or notes. A receiver that needs details calls the API
 * with its key. Deliveries ride the transactional outbox (written in the same transaction as
 * the change), are signed with HMAC-SHA256 and retried with backoff.
 *
 * Signature: X-Webhook-Signature: v1=<hex HMAC-SHA256(secret, `${timestamp}.${body}`)>,
 * X-Webhook-Timestamp: unix seconds. Receivers should reject timestamps older than 5 minutes.
 */

export const WEBHOOK_EVENTS = [
  "reservation.created",
  "reservation.updated",
  "reservation.cancelled",
  "reservation.no_show",
  "stay.checked_in",
  "stay.checked_out",
  "request.created",
  "request.completed",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

const MAX_ENDPOINTS = 10;

/** Private, loopback, link-local and metadata ranges are never valid webhook targets. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x === "::1" || x === "::") return true;
    if (x.startsWith("::ffff:")) return isPrivateAddress(x.slice(7));
    return x.startsWith("fc") || x.startsWith("fd") || x.startsWith("fe80") || x.startsWith("ff");
  }
  return true;
}

export const webhookUrlSchema = z
  .url("Enter a full https:// URL")
  .max(500)
  .refine((u) => {
    try {
      const url = new URL(u);
      if (url.protocol !== "https:" || url.username || url.password) return false;
      if (url.port && url.port !== "443") return false;
      const host = url.hostname.replace(/^\[|\]$/g, "");
      if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
      if (isIP(host) && isPrivateAddress(host)) return false;
      return true;
    } catch {
      return false;
    }
  }, "Use a public https:// address (port 443, no credentials, no private or local hosts)");

export const webhookSchema = z.object({
  url: webhookUrlSchema,
  description: optionalText(100),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, "Choose at least one event"),
});

export async function createWebhook(db: Db, ctx: TenantContext, raw: z.input<typeof webhookSchema>) {
  authorize(ctx, "tenant.manage");
  assertTenantWritable(ctx);
  await assertModule(db, ctx.tenantId, "integrations");
  const input = webhookSchema.parse(raw);
  const existing = await db.select({ id: webhookEndpoints.id }).from(webhookEndpoints).where(eq(webhookEndpoints.tenantId, ctx.tenantId));
  if (existing.length >= MAX_ENDPOINTS) throw conflict(`Up to ${MAX_ENDPOINTS} webhook endpoints.`);
  const secret = `whsec_${generateQrToken()}`;
  const row = await db.transaction(async (tx) => {
    const [w] = await tx
      .insert(webhookEndpoints)
      .values({
        tenantId: ctx.tenantId,
        url: input.url,
        description: input.description,
        secretCiphertext: encryptSecret(secret),
        events: [...new Set(input.events)],
        createdByUserId: ctx.userId,
      })
      .returning();
    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      actorType: "user",
      action: "webhook.created",
      entityType: "webhook_endpoint",
      entityId: w.id,
      metadata: { host: new URL(w.url).host, events: w.events },
    });
    return w;
  });
  return { endpoint: row, secret };
}

export async function listWebhooks(db: Db, ctx: TenantContext) {
  authorize(ctx, "tenant.manage");
  return db
    .select({
      id: webhookEndpoints.id,
      url: webhookEndpoints.url,
      description: webhookEndpoints.description,
      events: webhookEndpoints.events,
      active: webhookEndpoints.active,
      lastDeliveryAt: webhookEndpoints.lastDeliveryAt,
      lastStatus: webhookEndpoints.lastStatus,
      lastError: webhookEndpoints.lastError,
      consecutiveFailures: webhookEndpoints.consecutiveFailures,
    })
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.tenantId, ctx.tenantId))
    .orderBy(desc(webhookEndpoints.createdAt));
}

async function ownEndpoint(db: Db, ctx: TenantContext, id: string) {
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) throw notFound("Webhook not found.");
  const [w] = await db.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.id, parsed.data), eq(webhookEndpoints.tenantId, ctx.tenantId)));
  if (!w) throw notFound("Webhook not found.");
  return w;
}

export async function setWebhookActive(db: Db, ctx: TenantContext, id: string, active: boolean) {
  authorize(ctx, "tenant.manage");
  assertTenantWritable(ctx);
  const w = await ownEndpoint(db, ctx, id);
  await db.transaction(async (tx) => {
    await tx.update(webhookEndpoints).set({ active, consecutiveFailures: active ? 0 : w.consecutiveFailures }).where(eq(webhookEndpoints.id, w.id));
    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      actorType: "user",
      action: active ? "webhook.enabled" : "webhook.disabled",
      entityType: "webhook_endpoint",
      entityId: w.id,
      metadata: { host: new URL(w.url).host },
    });
  });
}

export async function deleteWebhook(db: Db, ctx: TenantContext, id: string) {
  authorize(ctx, "tenant.manage");
  const w = await ownEndpoint(db, ctx, id);
  await db.transaction(async (tx) => {
    await tx.delete(webhookEndpoints).where(eq(webhookEndpoints.id, w.id));
    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      actorType: "user",
      action: "webhook.deleted",
      entityType: "webhook_endpoint",
      entityId: w.id,
      metadata: { host: new URL(w.url).host },
    });
  });
}

/**
 * Inside the business transaction: one outbox job per active endpoint subscribed to the event.
 * Cheap when a hotel has no endpoints (one indexed query).
 */
export async function enqueueWebhookEvent(tx: Db, tenantId: string, event: WebhookEvent, data: Record<string, unknown>) {
  const targets = await tx
    .select({ id: webhookEndpoints.id })
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.tenantId, tenantId), eq(webhookEndpoints.active, true), sql`${webhookEndpoints.events} @> ${JSON.stringify([event])}::jsonb`));
  if (targets.length === 0) return;
  const id = crypto.randomUUID();
  const occurredAt = new Date().toISOString();
  await tx.insert(outboxEvents).values(
    targets.map((t) => ({
      tenantId,
      eventType: `webhook.${event}`,
      channels: [],
      payload: { endpointId: t.id, event: { id, type: event, createdAt: occurredAt, data } },
    })),
  );
}

export function signWebhook(secret: string, timestamp: number, body: string) {
  return `v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

export type Resolver = (host: string) => Promise<string[]>;
const dnsResolver: Resolver = async (host) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

const deliverySchema = z.object({
  endpointId: z.uuid(),
  event: z.object({ id: z.uuid(), type: z.string(), createdAt: z.string(), data: z.record(z.string(), z.unknown()) }),
});

/**
 * POSTs one event. Throws on failure so the outbox retries with backoff. Re-resolves the host
 * and refuses private addresses at send time (defence against DNS changes after creation).
 */
export async function deliverWebhook(
  db: Db,
  tenantId: string,
  raw: unknown,
  deps: { fetch?: typeof fetch; resolve?: Resolver; now?: Date } = {},
) {
  const p = deliverySchema.parse(raw);
  const [w] = await db.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.id, p.endpointId), eq(webhookEndpoints.tenantId, tenantId)));
  if (!w || !w.active) return { skipped: true };
  const url = new URL(w.url);
  const addresses = await (deps.resolve ?? dnsResolver)(url.hostname.replace(/^\[|\]$/g, ""));
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    await recordResult(db, w.id, null, "Refused: the host resolves to a private address");
    throw new Error("webhook host resolves to a private address");
  }
  const body = JSON.stringify(p.event);
  const ts = Math.floor((deps.now ?? new Date()).getTime() / 1000);
  let status: number | null = null;
  try {
    const res = await (deps.fetch ?? fetch)(w.url, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "HotelQR-Webhooks/1",
        "X-Webhook-Id": p.event.id,
        "X-Webhook-Event": p.event.type,
        "X-Webhook-Timestamp": String(ts),
        "X-Webhook-Signature": signWebhook(decryptSecret(w.secretCiphertext), ts, body),
      },
      body,
      signal: AbortSignal.timeout(8000),
    });
    status = res.status;
    if (res.status < 200 || res.status >= 300) throw new Error(`receiver answered ${res.status}`);
  } catch (err) {
    await recordResult(db, w.id, status, err instanceof Error ? err.message.slice(0, 200) : "delivery failed");
    throw err;
  }
  await recordResult(db, w.id, status, null);
  return { skipped: false, status };
}

async function recordResult(db: Db, endpointId: string, status: number | null, error: string | null) {
  await db
    .update(webhookEndpoints)
    .set({
      lastDeliveryAt: new Date(),
      lastStatus: status,
      lastError: error,
      consecutiveFailures: error ? sql`${webhookEndpoints.consecutiveFailures} + 1` : 0,
      // An endpoint failing for a long time (≈ 50 deliveries) is paused; the hotel can re-enable it.
      active: error ? sql`${webhookEndpoints.consecutiveFailures} + 1 < 50` : true,
    })
    .where(eq(webhookEndpoints.id, endpointId));
}

/** "Send test event" from the settings page. */
export async function sendTestWebhook(db: Db, ctx: TenantContext, id: string, deps: { fetch?: typeof fetch; resolve?: Resolver } = {}) {
  authorize(ctx, "tenant.manage");
  const w = await ownEndpoint(db, ctx, id);
  return deliverWebhook(
    db,
    ctx.tenantId,
    { endpointId: w.id, event: { id: crypto.randomUUID(), type: "ping", createdAt: new Date().toISOString(), data: { message: "Test event" } } },
    deps,
  );
}
