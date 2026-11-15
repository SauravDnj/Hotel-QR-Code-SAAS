import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/types";
import { floors, roomCategories, rooms, roomStatusHistory, users } from "@/lib/db/schema";
import {
  housekeepingStatus,
  roomOperationalStatus,
  type HousekeepingStatus,
  type RoomOperationalStatus,
} from "@/lib/db/schema/enums";
import { conflict, notFound } from "@/lib/errors";
import type { TenantContext } from "@/lib/permissions/authorize";
import { optionalText } from "@/lib/validation/common";
import { writeAudit } from "@/modules/audit/service";
import { idSchema, requireProperty } from "@/modules/properties/access";
import { isUniqueViolation } from "./db-errors";

export const OPERATIONAL_STATUSES = roomOperationalStatus.enumValues;
export const HOUSEKEEPING_STATUSES = housekeepingStatus.enumValues;

export const roomCodeSchema = z
  .string()
  .trim()
  .min(1, "Room number is required")
  .max(20, "Room number is too long")
  .regex(/^[A-Za-z0-9][A-Za-z0-9 \-/.]*$/, "Use letters, numbers, spaces, - / or .");

const optionalCapacity = z
  .union([z.literal(""), z.coerce.number().int().min(1).max(50)])
  .optional()
  .transform((v) => (v === "" || v === undefined ? null : v));

export const roomInputSchema = z.object({
  roomCode: roomCodeSchema,
  floorId: idSchema("floor"),
  categoryId: idSchema("room type"),
  capacity: optionalCapacity,
  notes: optionalText(1000),
});
export type RoomInput = z.input<typeof roomInputSchema>;

export const bulkRoomSchema = z
  .object({
    floorId: idSchema("floor"),
    categoryId: idSchema("room type"),
    prefix: z.string().trim().max(8).regex(/^[A-Za-z0-9-]*$/, "Prefix: letters, numbers or -").default(""),
    start: z.coerce.number().int().min(0).max(99999),
    end: z.coerce.number().int().min(0).max(99999),
  })
  .refine((v) => v.end >= v.start, { path: ["end"], message: "End must be ≥ start" })
  .refine((v) => v.end - v.start < 200, { path: ["end"], message: "Up to 200 rooms at a time" });
export type BulkRoomInput = z.input<typeof bulkRoomSchema>;

export const roomFilterSchema = z.object({
  // URL input: anything malformed (arrays, overlong text) is ignored, never a 500.
  q: z.string().trim().max(40).optional().catch(undefined),
  floorId: z.uuid().optional().catch(undefined),
  categoryId: z.uuid().optional().catch(undefined),
  operational: z.enum(OPERATIONAL_STATUSES).optional().catch(undefined),
  housekeeping: z.enum(HOUSEKEEPING_STATUSES).optional().catch(undefined),
  archived: z.enum(["only"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).default(1).catch(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(48).catch(48),
});
export type RoomFilter = z.input<typeof roomFilterSchema>;

/** Escape LIKE wildcards so search text is matched literally. */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function listRooms(db: Db, ctx: TenantContext, propertyId: string, rawFilter: RoomFilter = {}) {
  const property = await requireProperty(db, ctx, propertyId, "room.view");
  const f = roomFilterSchema.parse(rawFilter);
  const where: SQL[] = [eq(rooms.tenantId, ctx.tenantId), eq(rooms.propertyId, property.id)];
  where.push(f.archived === "only" ? isNotNull(rooms.archivedAt) : isNull(rooms.archivedAt));
  if (f.q) where.push(ilike(rooms.roomCode, `%${likeEscape(f.q)}%`));
  if (f.floorId) where.push(eq(rooms.floorId, f.floorId));
  if (f.categoryId) where.push(eq(rooms.categoryId, f.categoryId));
  if (f.operational) where.push(eq(rooms.operationalStatus, f.operational));
  if (f.housekeeping) where.push(eq(rooms.housekeepingStatus, f.housekeeping));
  const condition = and(...where);

  const [{ total }] = await db.select({ total: count() }).from(rooms).where(condition);
  const items = await db
    .select({
      id: rooms.id,
      roomCode: rooms.roomCode,
      operationalStatus: rooms.operationalStatus,
      housekeepingStatus: rooms.housekeepingStatus,
      capacity: sql<number>`coalesce(${rooms.capacity}, ${roomCategories.capacity})`.mapWith(Number),
      floorId: rooms.floorId,
      floorName: floors.name,
      categoryName: roomCategories.name,
      archivedAt: rooms.archivedAt,
    })
    .from(rooms)
    .innerJoin(floors, eq(floors.id, rooms.floorId))
    .innerJoin(roomCategories, eq(roomCategories.id, rooms.categoryId))
    .where(condition)
    // Natural order: floor, then letter prefix, then first number (so 9 < 10 < 101 < A101).
    .orderBy(
      asc(floors.sortOrder),
      asc(sql`lower(substring(${rooms.roomCode} from '^[^0-9]*'))`),
      asc(sql`substring(${rooms.roomCode} from '[0-9]{1,15}')::bigint`),
      asc(rooms.roomCode),
    )
    .limit(f.pageSize)
    .offset((f.page - 1) * f.pageSize);

  return { items, total, page: f.page, pageSize: f.pageSize, pageCount: Math.max(1, Math.ceil(total / f.pageSize)) };
}

/** Per-status counts for the property's live rooms (dashboard and filter chips). */
export async function roomStatusSummary(db: Db, ctx: TenantContext, propertyId: string) {
  const property = await requireProperty(db, ctx, propertyId, "room.view");
  const base = and(eq(rooms.tenantId, ctx.tenantId), eq(rooms.propertyId, property.id), isNull(rooms.archivedAt));
  const [operational, housekeeping] = await Promise.all([
    db.select({ status: rooms.operationalStatus, n: count() }).from(rooms).where(base).groupBy(rooms.operationalStatus),
    db.select({ status: rooms.housekeepingStatus, n: count() }).from(rooms).where(base).groupBy(rooms.housekeepingStatus),
  ]);
  const total = operational.reduce((s, r) => s + r.n, 0);
  return {
    total,
    operational: Object.fromEntries(operational.map((r) => [r.status, r.n])) as Partial<Record<RoomOperationalStatus, number>>,
    housekeeping: Object.fromEntries(housekeeping.map((r) => [r.status, r.n])) as Partial<Record<HousekeepingStatus, number>>,
  };
}

export async function getRoom(db: Db, ctx: TenantContext, propertyId: string, roomId: string) {
  const property = await requireProperty(db, ctx, propertyId, "room.view");
  const id = z.uuid().safeParse(roomId);
  if (!id.success) throw notFound("Room not found.");
  const [row] = await db
    .select({
      room: rooms,
      floorName: floors.name,
      categoryName: roomCategories.name,
      categoryCapacity: roomCategories.capacity,
    })
    .from(rooms)
    .innerJoin(floors, eq(floors.id, rooms.floorId))
    .innerJoin(roomCategories, eq(roomCategories.id, rooms.categoryId))
    .where(and(eq(rooms.id, id.data), eq(rooms.propertyId, property.id), eq(rooms.tenantId, ctx.tenantId)));
  if (!row) throw notFound("Room not found.");
  return { ...row.room, floorName: row.floorName, categoryName: row.categoryName, categoryCapacity: row.categoryCapacity, property };
}

/** Floor and category must be live and belong to this property (also enforced by FKs). */
async function assertParents(db: Db, ctx: TenantContext, propertyId: string, floorId: string, categoryId: string) {
  const [[floor], [category]] = await Promise.all([
    db
      .select({ id: floors.id })
      .from(floors)
      .where(and(eq(floors.id, floorId), eq(floors.propertyId, propertyId), eq(floors.tenantId, ctx.tenantId), isNull(floors.archivedAt))),
    db
      .select({ id: roomCategories.id })
      .from(roomCategories)
      .where(
        and(
          eq(roomCategories.id, categoryId),
          eq(roomCategories.propertyId, propertyId),
          eq(roomCategories.tenantId, ctx.tenantId),
          isNull(roomCategories.archivedAt),
        ),
      ),
  ]);
  if (!floor) throw new z.ZodError([{ code: "custom", path: ["floorId"], message: "Choose a floor of this property", input: floorId }]);
  if (!category)
    throw new z.ZodError([{ code: "custom", path: ["categoryId"], message: "Choose a room type of this property", input: categoryId }]);
}

const duplicateCode = (code: string) => conflict(`Room ${code} already exists in this property.`);

export async function createRoom(db: Db, ctx: TenantContext, propertyId: string, raw: RoomInput) {
  const property = await requireProperty(db, ctx, propertyId, "room.manage", { write: true });
  const input = roomInputSchema.parse(raw);
  await assertParents(db, ctx, property.id, input.floorId, input.categoryId);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(rooms)
        .values({ ...input, tenantId: ctx.tenantId, propertyId: property.id })
        .returning();
      await writeAudit(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        actorType: "user",
        action: "room.created",
        entityType: "room",
        entityId: row.id,
        metadata: { propertyId: property.id, roomCode: row.roomCode },
      });
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw duplicateCode(input.roomCode);
    throw err;
  }
}

/** Creates e.g. rooms 101–120 in one transaction. Fails as a whole if any code exists. */
export async function bulkCreateRooms(db: Db, ctx: TenantContext, propertyId: string, raw: BulkRoomInput) {
  const property = await requireProperty(db, ctx, propertyId, "room.manage", { write: true });
  const input = bulkRoomSchema.parse(raw);
  await assertParents(db, ctx, property.id, input.floorId, input.categoryId);
  const codes = Array.from({ length: input.end - input.start + 1 }, (_, i) => `${input.prefix}${input.start + i}`);

  const existing = await db
    .select({ code: rooms.roomCode })
    .from(rooms)
    .where(
      and(
        eq(rooms.tenantId, ctx.tenantId),
        eq(rooms.propertyId, property.id),
        isNull(rooms.archivedAt),
        inArray(sql`lower(${rooms.roomCode})`, codes.map((c) => c.toLowerCase())),
      ),
    );
  if (existing.length) {
    const list = existing.map((e) => e.code).slice(0, 10).join(", ");
    throw conflict(`These rooms already exist: ${list}${existing.length > 10 ? "…" : ""}. Nothing was created.`);
  }

  try {
    return await db.transaction(async (tx) => {
      const created = await tx
        .insert(rooms)
        .values(
          codes.map((roomCode) => ({
            roomCode,
            floorId: input.floorId,
            categoryId: input.categoryId,
            tenantId: ctx.tenantId,
            propertyId: property.id,
          })),
        )
        .returning({ id: rooms.id });
      await writeAudit(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        actorType: "user",
        action: "room.bulk_created",
        entityType: "room",
        metadata: { propertyId: property.id, count: created.length, first: codes[0], last: codes.at(-1) },
      });
      return { count: created.length };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("Some of these rooms were just created by someone else. Nothing was created.");
    throw err;
  }
}

export async function updateRoom(db: Db, ctx: TenantContext, propertyId: string, roomId: string, raw: RoomInput) {
  const existing = await getRoom(db, ctx, propertyId, roomId);
  await requireProperty(db, ctx, propertyId, "room.manage", { write: true });
  if (existing.archivedAt) throw conflict("Restore this room before editing it.");
  const input = roomInputSchema.parse(raw);
  await assertParents(db, ctx, existing.propertyId, input.floorId, input.categoryId);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .update(rooms)
        .set(input)
        .where(and(eq(rooms.id, existing.id), eq(rooms.tenantId, ctx.tenantId)))
        .returning();
      const changed = (["roomCode", "floorId", "categoryId", "capacity", "notes"] as const).filter(
        (k) => input[k] !== existing[k],
      );
      await writeAudit(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        actorType: "user",
        action: "room.updated",
        entityType: "room",
        entityId: row.id,
        metadata: { propertyId: existing.propertyId, roomCode: row.roomCode, changedFields: changed },
      });
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw duplicateCode(input.roomCode);
    throw err;
  }
}

export const statusChangeSchema = z.discriminatedUnion("dimension", [
  z.object({ dimension: z.literal("operational"), status: z.enum(OPERATIONAL_STATUSES), note: optionalText(300) }),
  z.object({ dimension: z.literal("housekeeping"), status: z.enum(HOUSEKEEPING_STATUSES), note: optionalText(300) }),
]);
export type StatusChangeInput = z.input<typeof statusChangeSchema>;

/**
 * Changes ONE status dimension. Operational status needs room.manage; housekeeping status
 * needs housekeeping.manage, so housekeepers can mark rooms clean without being able to
 * take rooms out of order. The row is locked so concurrent changes are serialised.
 */
export async function changeRoomStatus(
  db: Db,
  ctx: TenantContext,
  propertyId: string,
  roomId: string,
  raw: StatusChangeInput,
) {
  const input = statusChangeSchema.parse(raw);
  const permission = input.dimension === "operational" ? "room.manage" : "housekeeping.manage";
  const property = await requireProperty(db, ctx, propertyId, permission, { write: true });
  const id = z.uuid().safeParse(roomId);
  if (!id.success) throw notFound("Room not found.");

  return db.transaction(async (tx) => {
    const [room] = await tx
      .select()
      .from(rooms)
      .where(and(eq(rooms.id, id.data), eq(rooms.propertyId, property.id), eq(rooms.tenantId, ctx.tenantId)))
      .for("update");
    if (!room) throw notFound("Room not found.");
    if (room.archivedAt) throw conflict("Archived rooms cannot change status.");
    const from = input.dimension === "operational" ? room.operationalStatus : room.housekeepingStatus;
    if (from === input.status) return room;

    const [updated] = await tx
      .update(rooms)
      .set(
        input.dimension === "operational"
          ? { operationalStatus: input.status }
          : { housekeepingStatus: input.status },
      )
      .where(eq(rooms.id, room.id))
      .returning();
    await tx.insert(roomStatusHistory).values({
      tenantId: ctx.tenantId,
      propertyId: property.id,
      roomId: room.id,
      dimension: input.dimension,
      fromStatus: from,
      toStatus: input.status,
      actorUserId: ctx.userId,
      note: input.note,
    });
    if (input.dimension === "operational") {
      await writeAudit(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        actorType: "user",
        action: "room.operational_status_changed",
        entityType: "room",
        entityId: room.id,
        metadata: { propertyId: property.id, roomCode: room.roomCode, from, to: input.status },
      });
    }
    return updated;
  });
}

export async function setRoomArchived(db: Db, ctx: TenantContext, propertyId: string, roomId: string, archived: boolean) {
  const existing = await getRoom(db, ctx, propertyId, roomId);
  await requireProperty(db, ctx, propertyId, "room.manage", { write: true });
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .update(rooms)
        .set({ archivedAt: archived ? new Date() : null })
        .where(and(eq(rooms.id, existing.id), eq(rooms.tenantId, ctx.tenantId)))
        .returning();
      await writeAudit(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        actorType: "user",
        action: archived ? "room.archived" : "room.restored",
        entityType: "room",
        entityId: existing.id,
        metadata: { propertyId: existing.propertyId, roomCode: existing.roomCode },
      });
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict(`A live room already uses code ${existing.roomCode}. Rename it first.`);
    throw err;
  }
}

export async function listRoomHistory(db: Db, ctx: TenantContext, propertyId: string, roomId: string) {
  const room = await getRoom(db, ctx, propertyId, roomId);
  return db
    .select({
      id: roomStatusHistory.id,
      dimension: roomStatusHistory.dimension,
      fromStatus: roomStatusHistory.fromStatus,
      toStatus: roomStatusHistory.toStatus,
      note: roomStatusHistory.note,
      changedAt: roomStatusHistory.changedAt,
      actorName: users.name,
    })
    .from(roomStatusHistory)
    .leftJoin(users, eq(users.id, roomStatusHistory.actorUserId))
    .where(and(eq(roomStatusHistory.roomId, room.id), eq(roomStatusHistory.tenantId, ctx.tenantId)))
    .orderBy(desc(roomStatusHistory.changedAt))
    .limit(50);
}
