import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/types";
import { floors, roomQrCodes, rooms, users } from "@/lib/db/schema";
import { decryptSecret, guestPortalUrl } from "@/lib/crypto/secrets";
import { conflict, notFound } from "@/lib/errors";
import type { TenantContext } from "@/lib/permissions/authorize";
import { writeAudit } from "@/modules/audit/service";
import { requireProperty } from "@/modules/properties/access";
import { isUniqueViolation } from "@/modules/rooms/db-errors";
import { insertQrCodes } from "./issue";
import { getRoom, roomNaturalOrder } from "@/modules/rooms/rooms";

/**
 * Room QR lifecycle (PRD FR-03). A QR identifies a room, never a guest. Rules:
 * - one active code per room (partial unique index);
 * - rotate = revoke the current code (reason "rotated") and issue a new one; rotated or
 *   compromised codes can never come back;
 * - deactivate = temporary revoke (reason "deactivated") that can be reactivated, e.g. while a
 *   room is renovated, so the printed sticker keeps working afterwards;
 * - every change is audited in the same transaction; tokens never reach logs or audit metadata.
 */

export const REVOKE_REASONS = ["deactivated", "rotated", "compromised"] as const;
export type RevokeReason = (typeof REVOKE_REASONS)[number];

function urlFor(tokenCiphertext: string): string {
  return guestPortalUrl(decryptSecret(tokenCiphertext));
}

const qrIdSchema = z.uuid();

async function lockRoom(tx: Db, ctx: TenantContext, roomId: string) {
  await tx.execute(sql`select id from ${rooms} where ${rooms.id} = ${roomId} and ${rooms.tenantId} = ${ctx.tenantId} for update`);
}

async function activeCode(tx: Db, ctx: TenantContext, roomId: string) {
  const [row] = await tx
    .select()
    .from(roomQrCodes)
    .where(and(eq(roomQrCodes.tenantId, ctx.tenantId), eq(roomQrCodes.roomId, roomId), eq(roomQrCodes.status, "active")));
  return row;
}

async function liveRoom(db: Db, ctx: TenantContext, propertyId: string, roomId: string) {
  const room = await getRoom(db, ctx, propertyId, roomId);
  if (room.archivedAt) throw conflict("Restore this room before changing its QR code.");
  return room;
}

/** Active code (with its printable URL) and the room's QR history. */
export async function getRoomQr(db: Db, ctx: TenantContext, propertyId: string, roomId: string) {
  await requireProperty(db, ctx, propertyId, "qr.view");
  const room = await getRoom(db, ctx, propertyId, roomId);
  const history = await db
    .select({
      id: roomQrCodes.id,
      status: roomQrCodes.status,
      tokenCiphertext: roomQrCodes.tokenCiphertext,
      issuedAt: roomQrCodes.issuedAt,
      revokedAt: roomQrCodes.revokedAt,
      revokeReason: roomQrCodes.revokeReason,
      scanCount: roomQrCodes.scanCount,
      lastScannedAt: roomQrCodes.lastScannedAt,
      issuedBy: users.name,
    })
    .from(roomQrCodes)
    .leftJoin(users, eq(users.id, roomQrCodes.issuedByUserId))
    .where(and(eq(roomQrCodes.tenantId, ctx.tenantId), eq(roomQrCodes.roomId, room.id)))
    .orderBy(desc(roomQrCodes.issuedAt))
    .limit(20);
  const active = history.find((h) => h.status === "active");
  return {
    room,
    active: active ? { ...strip(active), url: urlFor(active.tokenCiphertext) } : null,
    history: history.map(strip),
  };
}

function strip<T extends { tokenCiphertext: string }>(row: T): Omit<T, "tokenCiphertext"> {
  const rest = { ...row } as Partial<T>;
  delete rest.tokenCiphertext;
  return rest as Omit<T, "tokenCiphertext">;
}

export async function issueRoomQr(db: Db, ctx: TenantContext, propertyId: string, roomId: string) {
  const property = await requireProperty(db, ctx, propertyId, "qr.manage", { write: true });
  const room = await liveRoom(db, ctx, property.id, roomId);
  try {
    return await db.transaction(async (tx) => {
      await lockRoom(tx, ctx, room.id);
      if (await activeCode(tx, ctx, room.id)) throw conflict("This room already has an active QR code.");
      const [row] = await insertQrCodes(tx, [{ tenantId: ctx.tenantId, propertyId: property.id, roomId: room.id }], ctx.userId);
      await audit(tx, ctx, "qr.issued", row.id, { propertyId: property.id, roomCode: room.roomCode });
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("This room already has an active QR code.");
    throw err;
  }
}

/** Invalidates the printed code immediately and issues a new one. */
export async function rotateRoomQr(
  db: Db,
  ctx: TenantContext,
  propertyId: string,
  roomId: string,
  reason: "rotated" | "compromised" = "rotated",
) {
  const property = await requireProperty(db, ctx, propertyId, "qr.rotate", { write: true });
  const room = await liveRoom(db, ctx, property.id, roomId);
  return db.transaction(async (tx) => {
    await lockRoom(tx, ctx, room.id);
    const current = await activeCode(tx, ctx, room.id);
    if (current) {
      await tx
        .update(roomQrCodes)
        .set({ status: "revoked", revokedAt: new Date(), revokedByUserId: ctx.userId, revokeReason: reason })
        .where(and(eq(roomQrCodes.id, current.id), eq(roomQrCodes.tenantId, ctx.tenantId)));
    }
    const [row] = await insertQrCodes(tx, [{ tenantId: ctx.tenantId, propertyId: property.id, roomId: room.id }], ctx.userId);
    await audit(tx, ctx, "qr.rotated", row.id, {
      propertyId: property.id,
      roomCode: room.roomCode,
      previousQrId: current?.id ?? null,
      reason,
    });
    return row;
  });
}

/** Temporarily switch off the room's code; the same sticker can be reactivated later. */
export async function deactivateRoomQr(db: Db, ctx: TenantContext, propertyId: string, roomId: string) {
  const property = await requireProperty(db, ctx, propertyId, "qr.manage", { write: true });
  const room = await getRoom(db, ctx, property.id, roomId);
  return db.transaction(async (tx) => {
    await lockRoom(tx, ctx, room.id);
    const current = await activeCode(tx, ctx, room.id);
    if (!current) throw conflict("This room has no active QR code.");
    await tx
      .update(roomQrCodes)
      .set({ status: "revoked", revokedAt: new Date(), revokedByUserId: ctx.userId, revokeReason: "deactivated" })
      .where(and(eq(roomQrCodes.id, current.id), eq(roomQrCodes.tenantId, ctx.tenantId)));
    await audit(tx, ctx, "qr.deactivated", current.id, { propertyId: property.id, roomCode: room.roomCode });
  });
}

/** Reactivates a code that was deactivated (never one that was rotated or compromised). */
export async function reactivateRoomQr(db: Db, ctx: TenantContext, propertyId: string, roomId: string, qrId: string) {
  const property = await requireProperty(db, ctx, propertyId, "qr.manage", { write: true });
  const room = await liveRoom(db, ctx, property.id, roomId);
  const id = qrIdSchema.safeParse(qrId);
  if (!id.success) throw notFound("QR code not found.");
  try {
    return await db.transaction(async (tx) => {
      await lockRoom(tx, ctx, room.id);
      const [row] = await tx
        .select()
        .from(roomQrCodes)
        .where(and(eq(roomQrCodes.id, id.data), eq(roomQrCodes.tenantId, ctx.tenantId), eq(roomQrCodes.roomId, room.id)));
      if (!row) throw notFound("QR code not found.");
      if (row.status !== "revoked" || row.revokeReason !== "deactivated") {
        throw conflict("Only a deactivated QR code can be reactivated. Rotated codes stay invalid.");
      }
      if (await activeCode(tx, ctx, room.id)) throw conflict("This room already has an active QR code.");
      await tx
        .update(roomQrCodes)
        .set({ status: "active", revokedAt: null, revokedByUserId: null, revokeReason: null })
        .where(eq(roomQrCodes.id, row.id));
      await audit(tx, ctx, "qr.reactivated", row.id, { propertyId: property.id, roomCode: room.roomCode });
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("This room already has an active QR code.");
    throw err;
  }
}

const floorFilter = z.uuid().optional().catch(undefined);

/** Rooms of a property with their active QR (if any), in natural order. */
export async function listPropertyQr(db: Db, ctx: TenantContext, propertyId: string, opts: { floorId?: string } = {}) {
  const property = await requireProperty(db, ctx, propertyId, "qr.view");
  const floorId = floorFilter.parse(opts.floorId);
  const items = await db
    .select({
      roomId: rooms.id,
      roomCode: rooms.roomCode,
      floorId: rooms.floorId,
      floorName: floors.name,
      qrId: roomQrCodes.id,
      issuedAt: roomQrCodes.issuedAt,
      scanCount: roomQrCodes.scanCount,
      lastScannedAt: roomQrCodes.lastScannedAt,
    })
    .from(rooms)
    .innerJoin(floors, eq(floors.id, rooms.floorId))
    .leftJoin(
      roomQrCodes,
      and(eq(roomQrCodes.roomId, rooms.id), eq(roomQrCodes.status, "active"), eq(roomQrCodes.tenantId, ctx.tenantId)),
    )
    .where(
      and(
        eq(rooms.tenantId, ctx.tenantId),
        eq(rooms.propertyId, property.id),
        isNull(rooms.archivedAt),
        floorId ? eq(rooms.floorId, floorId) : undefined,
      ),
    )
    .orderBy(asc(floors.sortOrder), ...roomNaturalOrder)
    .limit(2000);
  return { property, items };
}

/** Issues codes for every live room (optionally one floor) that has none. All-or-nothing. */
export async function issueMissingQr(db: Db, ctx: TenantContext, propertyId: string, opts: { floorId?: string } = {}) {
  const property = await requireProperty(db, ctx, propertyId, "qr.manage", { write: true });
  const { items } = await listPropertyQr(db, ctx, property.id, opts);
  const missing = items.filter((i) => !i.qrId);
  if (missing.length === 0) return { count: 0 };
  try {
    return await db.transaction(async (tx) => {
      const created = await insertQrCodes(
        tx,
        missing.map((m) => ({ tenantId: ctx.tenantId, propertyId: property.id, roomId: m.roomId })),
        ctx.userId,
      );
      await audit(tx, ctx, "qr.bulk_issued", null, { propertyId: property.id, count: created.length });
      return { count: created.length };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("Someone else just generated QR codes. Refresh and try again.");
    throw err;
  }
}

/** Printable sheet: active codes with URLs for a property or one floor. */
export async function qrSheet(db: Db, ctx: TenantContext, propertyId: string, opts: { floorId?: string } = {}) {
  const property = await requireProperty(db, ctx, propertyId, "qr.view");
  const floorId = floorFilter.parse(opts.floorId);
  const rows = await db
    .select({
      roomCode: rooms.roomCode,
      floorName: floors.name,
      tokenCiphertext: roomQrCodes.tokenCiphertext,
    })
    .from(roomQrCodes)
    .innerJoin(rooms, and(eq(rooms.id, roomQrCodes.roomId), eq(rooms.tenantId, roomQrCodes.tenantId)))
    .innerJoin(floors, eq(floors.id, rooms.floorId))
    .where(
      and(
        eq(roomQrCodes.tenantId, ctx.tenantId),
        eq(roomQrCodes.propertyId, property.id),
        eq(roomQrCodes.status, "active"),
        isNull(rooms.archivedAt),
        floorId ? eq(rooms.floorId, floorId) : undefined,
      ),
    )
    .orderBy(asc(floors.sortOrder), ...roomNaturalOrder)
    .limit(1000);
  return {
    property,
    items: rows.map((r) => ({ roomCode: r.roomCode, floorName: r.floorName, url: urlFor(r.tokenCiphertext) })),
  };
}

function audit(tx: Db, ctx: TenantContext, action: string, entityId: string | null, metadata: Record<string, unknown>) {
  return writeAudit(tx, {
    tenantId: ctx.tenantId,
    actorUserId: ctx.userId,
    actorType: "user",
    action,
    entityType: "room_qr_code",
    entityId,
    metadata,
  });
}
