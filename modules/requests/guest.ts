import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/types";
import {
  departments,
  guestPortalSettings,
  properties,
  requestItems,
  requestStatusHistory,
  serviceItems,
  serviceRequests,
  stays,
} from "@/lib/db/schema";
import { decryptSecret, encryptSecret, generateQrToken, hashQrToken, isWellFormedQrToken } from "@/lib/crypto/secrets";
import { consumeRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { findActiveQr } from "@/modules/guest-portal/public";
import { enqueueRequestEvent } from "@/modules/realtime/outbox";
import { enqueueNotification } from "@/modules/notifications/service";
import { enqueueWebhookEvent } from "@/modules/integrations/webhooks";
import { isUniqueViolation } from "@/modules/rooms/db-errors";
import { isAvailableAt, listGuestServices } from "@/modules/services/catalog";
import { GUEST_STATUS } from "./state";
import { listGuestMenu, priceOrder } from "@/modules/ordering/menu";
import { addDays, localDate, zonedToUtc } from "@/lib/timezones";

/**
 * Guest request submission (Zprompt/04). The QR token is the only identity input: tenant,
 * property, room and department are resolved on the server. A request, its first history
 * row and its outbox event are written in ONE transaction; the guest gets a receipt only
 * after commit. The receipt is a random status token (hash stored), scoped to this request.
 */

export const GUEST_TOKEN_TTL_HOURS = 72;
export const NOTE_MAX = 500;

export const guestRequestSchema = z.object({
  serviceId: z.uuid("Choose a service"),
  idempotencyKey: z.uuid("Please reload the page and try again"),
  quantity: z
    .union([z.literal(""), z.coerce.number().int()])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
  option: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => (v ? v : null)),
  note: z
    .string()
    .trim()
    .max(NOTE_MAX, `Please keep the note under ${NOTE_MAX} characters`)
    .optional()
    .transform((v) => (v ? v : null)),
  // Phase 9 — menu orders: menu item id → quantity; booking services: local date + time.
  items: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  paymentMethod: z.string().optional(),
  scheduledDate: z.string().optional(),
  scheduledTime: z.string().optional(),
});
export type GuestRequestInput = z.input<typeof guestRequestSchema>;

export const MAX_ORDER_LINES = 30;
export const MAX_LINE_QUANTITY = 20;
export const BOOKING_HORIZON_DAYS = 14;

export type SubmitResult =
  | { kind: "ok"; statusToken: string; duplicate: boolean; requestId: string }
  | { kind: "unavailable" }
  | { kind: "rate_limited" }
  | { kind: "invalid"; fieldErrors: Record<string, string[]>; message: string };

const invalid = (field: string, message: string): SubmitResult => ({
  kind: "invalid",
  fieldErrors: { [field]: [message] },
  message,
});

export async function submitGuestRequest(
  db: Db,
  qrToken: unknown,
  raw: GuestRequestInput,
  opts: { ip: string | null; now?: Date },
): Promise<SubmitResult> {
  if (opts.ip) {
    const byIp = await consumeRateLimit(db, `guest-request:ip:${opts.ip}`, RATE_LIMITS.guestRequestByIp);
    if (!byIp.allowed) return { kind: "rate_limited" };
  }
  const qr = await findActiveQr(db, qrToken);
  if (!qr) return { kind: "unavailable" };

  const parsed = guestRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors = z.flattenError(parsed.error).fieldErrors as Record<string, string[]>;
    return { kind: "invalid", fieldErrors, message: "Please check the form." };
  }
  const input = parsed.data;

  // Idempotency first: a double tap or retry returns the original receipt, not a new request.
  const existing = await findByIdempotencyKey(db, qr.tenantId, input.idempotencyKey);
  if (existing) {
    if (existing.qrCodeId !== qr.qrId) return { kind: "unavailable" };
    return { kind: "ok", statusToken: decryptSecret(existing.guestTokenCiphertext), duplicate: true, requestId: existing.id };
  }

  const byCode = await consumeRateLimit(db, `guest-request:qr:${qr.qrId}`, RATE_LIMITS.guestRequestByCode);
  if (!byCode.allowed) return { kind: "rate_limited" };

  const [service] = await db
    .select({ item: serviceItems, departmentName: departments.name })
    .from(serviceItems)
    .innerJoin(departments, eq(departments.id, serviceItems.departmentId))
    .where(
      and(
        eq(serviceItems.id, input.serviceId),
        eq(serviceItems.tenantId, qr.tenantId),
        eq(serviceItems.propertyId, qr.propertyId),
        eq(serviceItems.enabled, true),
        isNull(serviceItems.archivedAt),
        eq(departments.status, "active"),
      ),
    );
  if (!service) return invalid("serviceId", "This service is not available right now.");
  const item = service.item;
  const now = opts.now ?? new Date();
  // Bookings are for a later time, so the hours apply to the chosen time, not to now.
  if (item.kind !== "booking" && !isAvailableAt(item, qr.timezone, now)) {
    return invalid("serviceId", `This service is available ${item.availableFrom}–${item.availableTo}.`);
  }

  let scheduledFor: Date | null = null;
  if (item.kind === "booking") {
    const date = input.scheduledDate ?? "";
    const time = input.scheduledTime ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      return invalid("scheduledTime", "Please choose a date and time.");
    }
    scheduledFor = zonedToUtc(date, time, qr.timezone);
    if (scheduledFor.getTime() < now.getTime() - 5 * 60_000) return invalid("scheduledTime", "Please choose a time in the future.");
    if (scheduledFor.getTime() > now.getTime() + BOOKING_HORIZON_DAYS * 86400_000) {
      return invalid("scheduledDate", `You can book up to ${BOOKING_HORIZON_DAYS} days ahead.`);
    }
    if (!isAvailableAt(item, qr.timezone, scheduledFor)) {
      return invalid("scheduledTime", `Please choose a time between ${item.availableFrom} and ${item.availableTo}.`);
    }
  }

  // Menu orders: lines priced from the database; payment by room charge or on delivery.
  let order: { lines: Awaited<ReturnType<typeof priceOrder>> & object; paymentMethod: "room" | "on_delivery"; stayId: string | null } | null = null;
  if (item.kind === "menu") {
    const lines: { menuItemId: string; quantity: number }[] = [];
    for (const [id, raw] of Object.entries(input.items ?? {})) {
      const qty = Number(raw);
      if (!qty) continue;
      if (!z.uuid().safeParse(id).success || !Number.isInteger(qty) || qty < 0 || qty > MAX_LINE_QUANTITY) {
        return invalid("items", `Choose up to ${MAX_LINE_QUANTITY} of each item.`);
      }
      lines.push({ menuItemId: id, quantity: qty });
    }
    if (lines.length === 0) return invalid("items", "Please choose at least one item.");
    if (lines.length > MAX_ORDER_LINES) return invalid("items", "That's a very large order. Please call reception.");
    const priced = await priceOrder(db, { tenantId: qr.tenantId, propertyId: qr.propertyId, serviceItemId: item.id }, lines);
    if (!priced) return invalid("items", "Part of your order is no longer available. Please review the menu.");
    const [stay] = await db
      .select({ id: stays.id })
      .from(stays)
      .where(and(eq(stays.tenantId, qr.tenantId), eq(stays.roomId, qr.roomId), eq(stays.status, "checked_in")));
    const paymentMethod = input.paymentMethod === "room" ? "room" : "on_delivery";
    if (paymentMethod === "room" && (!item.allowRoomCharge || !stay)) {
      return invalid("paymentMethod", "Charging to the room isn't available here. Please choose to pay on delivery.");
    }
    order = { lines: priced, paymentMethod, stayId: stay?.id ?? null };
  }

  // Server-side field rules from the service configuration.
  let quantity: number | null = null;
  if (order) {
    quantity = order.lines.lines.reduce((n, l) => n + l.quantity, 0);
  } else if (item.maxQuantity > 0) {
    quantity = input.quantity ?? 1;
    if (quantity < 1 || quantity > item.maxQuantity) return invalid("quantity", `Choose 1 to ${item.maxQuantity}.`);
  }
  let option: string | null = null;
  if (item.options.length > 0) {
    if (!input.option || !item.options.includes(input.option)) return invalid("option", "Please choose an option.");
    option = input.option;
  }
  const note = item.noteMode === "none" ? null : input.note;
  if (item.noteMode === "required" && !note) return invalid("note", "Please tell us what you need.");

  const statusToken = generateQrToken();
  try {
    const requestId = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(serviceRequests)
        .values({
          tenantId: qr.tenantId,
          propertyId: qr.propertyId,
          roomId: qr.roomId,
          qrCodeId: qr.qrId,
          serviceItemId: item.id,
          departmentId: item.departmentId,
          serviceName: item.name,
          departmentName: service.departmentName,
          roomCode: qr.roomCode,
          priority: item.priority,
          targetMinutes: item.targetMinutes,
          escalateAfterMinutes: item.escalate ? item.targetMinutes : null,
          ackMessage: item.ackMessage,
          quantity,
          option,
          kind: item.kind,
          scheduledFor,
          totalMinor: order?.lines.totalMinor ?? null,
          currency: order ? qr.currency : null,
          paymentMethod: order?.paymentMethod ?? null,
          stayId: order?.stayId ?? null,
          guestNote: note,
          idempotencyKey: input.idempotencyKey,
          guestTokenHash: hashQrToken(statusToken),
          guestTokenCiphertext: encryptSecret(statusToken),
          guestTokenExpiresAt: new Date(now.getTime() + GUEST_TOKEN_TTL_HOURS * 3600_000),
          submittedAt: now,
        })
        .returning({ id: serviceRequests.id });
      if (order) {
        await tx.insert(requestItems).values(order.lines.lines.map((l) => ({ ...l, tenantId: qr.tenantId, requestId: row.id })));
      }
      await tx.insert(requestStatusHistory).values({
        tenantId: qr.tenantId,
        requestId: row.id,
        fromStatus: null,
        toStatus: "new",
        source: "guest",
      });
      await enqueueRequestEvent(tx, {
        tenantId: qr.tenantId,
        propertyId: qr.propertyId,
        departmentId: item.departmentId,
        requestId: row.id,
        type: "service_request.created",
      });
      await enqueueNotification(tx, {
        tenantId: qr.tenantId,
        propertyId: qr.propertyId,
        departmentId: item.departmentId,
        requestId: row.id,
        kind: "request_new",
      });
      await enqueueWebhookEvent(tx, qr.tenantId, "request.created", {
        requestId: row.id,
        propertyId: qr.propertyId,
        roomCode: qr.roomCode,
        service: item.name,
        department: service.departmentName,
        kind: item.kind,
        totalMinor: order?.lines.totalMinor ?? null,
        currency: order ? qr.currency : null,
        scheduledFor: scheduledFor?.toISOString() ?? null,
      });
      return row.id;
    });
    return { kind: "ok", statusToken, duplicate: false, requestId };
  } catch (err) {
    // Two concurrent submits with one key: the loser returns the winner's receipt.
    if (isUniqueViolation(err)) {
      const winner = await findByIdempotencyKey(db, qr.tenantId, input.idempotencyKey);
      if (winner && winner.qrCodeId === qr.qrId) {
        return { kind: "ok", statusToken: decryptSecret(winner.guestTokenCiphertext), duplicate: true, requestId: winner.id };
      }
    }
    throw err;
  }
}

/** Data for the guest request form. Does not count as a QR scan. */
export async function getGuestServiceForm(db: Db, qrToken: unknown, serviceId: string, opts: { ip: string | null }) {
  if (opts.ip) {
    const byIp = await consumeRateLimit(db, `qr-scan:ip:${opts.ip}`, RATE_LIMITS.qrScanByIp);
    if (!byIp.allowed) return null;
  }
  const qr = await findActiveQr(db, qrToken);
  if (!qr) return null;
  const services = await listGuestServices(db, { tenantId: qr.tenantId, propertyId: qr.propertyId, timezone: qr.timezone });
  const service = services.find((s) => s.id === serviceId);
  if (!service) return null;
  let menu: Awaited<ReturnType<typeof listGuestMenu>> = [];
  let canChargeRoom = false;
  if (service.kind === "menu") {
    menu = await listGuestMenu(db, { tenantId: qr.tenantId, propertyId: qr.propertyId, serviceItemId: service.id });
    if (service.allowRoomCharge) {
      const [stay] = await db
        .select({ id: stays.id })
        .from(stays)
        .where(and(eq(stays.tenantId, qr.tenantId), eq(stays.roomId, qr.roomId), eq(stays.status, "checked_in")));
      canChargeRoom = Boolean(stay);
    }
  }
  return {
    hotelName: qr.propertyName,
    accentColor: qr.settings?.accentColor ?? null,
    backgroundColor: qr.settings?.backgroundColor ?? null,
    serif: qr.settings?.fontStyle === "serif" || qr.settings?.theme === "elegant",
    roomLabel: qr.settings?.showRoomLabel === false ? null : qr.roomCode,
    currency: qr.currency,
    timezone: qr.timezone,
    service,
    menu,
    canChargeRoom,
    booking:
      service.kind === "booking"
        ? (() => {
            const today = localDate(new Date(), qr.timezone);
            return { minDate: today, maxDate: addDays(today, BOOKING_HORIZON_DAYS - 1), from: service.availableFrom, to: service.availableTo };
          })()
        : undefined,
  };
}

async function findByIdempotencyKey(db: Db, tenantId: string, key: string) {
  const [row] = await db
    .select({ id: serviceRequests.id, qrCodeId: serviceRequests.qrCodeId, guestTokenCiphertext: serviceRequests.guestTokenCiphertext })
    .from(serviceRequests)
    .where(and(eq(serviceRequests.tenantId, tenantId), eq(serviceRequests.idempotencyKey, key)));
  return row;
}

export interface GuestRequestView {
  hotelName: string;
  accentColor: string | null;
  timezone: string;
  serviceName: string;
  roomLabel: string | null;
  status: keyof typeof GUEST_STATUS;
  statusLabel: string;
  step: number;
  quantity: number | null;
  option: string | null;
  note: string | null;
  ackMessage: string | null;
  guestMessage: string | null;
  submittedAt: Date;
  updatedAt: Date;
  timeline: { label: string; at: Date }[];
  scheduledFor: Date | null;
  order: { lines: { name: string; quantity: number; lineTotalMinor: number }[]; totalMinor: number; currency: string; paymentMethod: string } | null;
}

export type StatusResult = { kind: "ok"; request: GuestRequestView } | { kind: "unavailable" } | { kind: "rate_limited" };

/** Guest receipt: only guest-safe fields, never internal notes, staff names or other requests. */
export async function getGuestRequestStatus(db: Db, token: unknown, opts: { ip: string | null }): Promise<StatusResult> {
  if (opts.ip) {
    const byIp = await consumeRateLimit(db, `guest-status:ip:${opts.ip}`, RATE_LIMITS.qrScanByIp);
    if (!byIp.allowed) return { kind: "rate_limited" };
  }
  if (!isWellFormedQrToken(token)) return { kind: "unavailable" };
  const [row] = await db
    .select({
      r: serviceRequests,
      hotelName: properties.name,
      timezone: properties.timezone,
      accentColor: guestPortalSettings.accentColor,
      showRoomLabel: guestPortalSettings.showRoomLabel,
    })
    .from(serviceRequests)
    .innerJoin(properties, and(eq(properties.id, serviceRequests.propertyId), eq(properties.tenantId, serviceRequests.tenantId)))
    .leftJoin(
      guestPortalSettings,
      and(eq(guestPortalSettings.propertyId, serviceRequests.propertyId), eq(guestPortalSettings.tenantId, serviceRequests.tenantId)),
    )
    .where(eq(serviceRequests.guestTokenHash, hashQrToken(token)));
  if (!row || row.r.guestTokenExpiresAt.getTime() < Date.now()) return { kind: "unavailable" };

  const history = await db
    .select({ to: requestStatusHistory.toStatus, at: requestStatusHistory.changedAt })
    .from(requestStatusHistory)
    .where(and(eq(requestStatusHistory.tenantId, row.r.tenantId), eq(requestStatusHistory.requestId, row.r.id)))
    .orderBy(asc(requestStatusHistory.changedAt));
  const timeline: { label: string; at: Date }[] = [];
  for (const h of history) {
    const label = GUEST_STATUS[h.to].label;
    if (timeline.at(-1)?.label !== label) timeline.push({ label, at: h.at });
  }

  const r = row.r;
  const lines =
    r.kind === "menu"
      ? await db
          .select({ name: requestItems.name, quantity: requestItems.quantity, lineTotalMinor: requestItems.lineTotalMinor })
          .from(requestItems)
          .where(and(eq(requestItems.tenantId, r.tenantId), eq(requestItems.requestId, r.id)))
          .orderBy(asc(requestItems.name))
      : [];
  return {
    kind: "ok",
    request: {
      hotelName: row.hotelName,
      accentColor: row.accentColor,
      timezone: row.timezone,
      serviceName: r.serviceName,
      roomLabel: row.showRoomLabel === false ? null : r.roomCode,
      status: r.status,
      statusLabel: GUEST_STATUS[r.status].label,
      step: GUEST_STATUS[r.status].step,
      quantity: r.quantity,
      option: r.option,
      note: r.guestNote,
      ackMessage: r.ackMessage,
      guestMessage: r.guestMessage,
      submittedAt: r.submittedAt,
      updatedAt: r.updatedAt,
      timeline,
      scheduledFor: r.scheduledFor,
      order:
        r.kind === "menu" && r.totalMinor !== null && r.currency
          ? { lines, totalMinor: r.totalMinor, currency: r.currency, paymentMethod: r.paymentMethod ?? "on_delivery" }
          : null,
    },
  };
}
