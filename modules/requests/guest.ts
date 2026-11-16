import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/types";
import {
  departments,
  guestPortalSettings,
  properties,
  requestStatusHistory,
  serviceItems,
  serviceRequests,
} from "@/lib/db/schema";
import { decryptSecret, encryptSecret, generateQrToken, hashQrToken, isWellFormedQrToken } from "@/lib/crypto/secrets";
import { consumeRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { findActiveQr } from "@/modules/guest-portal/public";
import { enqueueRequestEvent } from "@/modules/realtime/outbox";
import { isUniqueViolation } from "@/modules/rooms/db-errors";
import { isAvailableAt, listGuestServices } from "@/modules/services/catalog";
import { GUEST_STATUS } from "./state";

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
});
export type GuestRequestInput = z.input<typeof guestRequestSchema>;

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
  if (!isAvailableAt(item, qr.timezone, opts.now)) {
    return invalid("serviceId", `This service is available ${item.availableFrom}–${item.availableTo}.`);
  }

  // Server-side field rules from the service configuration.
  let quantity: number | null = null;
  if (item.maxQuantity > 0) {
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
  const now = opts.now ?? new Date();
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
          guestNote: note,
          idempotencyKey: input.idempotencyKey,
          guestTokenHash: hashQrToken(statusToken),
          guestTokenCiphertext: encryptSecret(statusToken),
          guestTokenExpiresAt: new Date(now.getTime() + GUEST_TOKEN_TTL_HOURS * 3600_000),
          submittedAt: now,
        })
        .returning({ id: serviceRequests.id });
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
  return {
    hotelName: qr.propertyName,
    accentColor: qr.settings?.accentColor ?? null,
    roomLabel: qr.settings?.showRoomLabel === false ? null : qr.roomCode,
    service,
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
    },
  };
}
