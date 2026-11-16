import { aliasedTable, and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/types";
import { floors, housekeepingTasks, properties, rooms, stays, users } from "@/lib/db/schema";
import { conflict, forbidden } from "@/lib/errors";
import { can, type TenantContext } from "@/lib/permissions/authorize";
import { optionalText } from "@/lib/validation/common";
import { writeAudit } from "@/modules/audit/service";
import { requireProperty } from "@/modules/properties/access";
import { isUniqueViolation } from "@/modules/rooms/db-errors";
import { roomNaturalOrder } from "@/modules/rooms/rooms";
import { roomReadiness } from "./readiness";
import { lockRoom, setHousekeepingStatus } from "./room-lock";

/**
 * Housekeeping workflow (Zprompt/07, PRD FR-10):
 *   checkout → room dirty + cleaning task
 *   start cleaning → task in progress, room in_progress
 *   finish cleaning → room clean (+ inspection task when the property requires inspection)
 *   inspection pass → room inspected (ready); fail → room dirty + new cleaning task
 * Each step locks the room row, so concurrent taps cannot create duplicate tasks (also
 * guarded by a partial unique index: one open task per room and type).
 */

type LockedRoom = Awaited<ReturnType<typeof lockRoom>>;

async function openTask(tx: Db, ctx: TenantContext, roomId: string, type: "cleaning" | "inspection") {
  const [t] = await tx
    .select()
    .from(housekeepingTasks)
    .where(
      and(
        eq(housekeepingTasks.tenantId, ctx.tenantId),
        eq(housekeepingTasks.roomId, roomId),
        eq(housekeepingTasks.taskType, type),
        inArray(housekeepingTasks.status, ["open", "in_progress"]),
      ),
    );
  return t;
}

/** Creates the task unless one is already open (idempotent; safe under retries). */
export async function ensureTask(
  tx: Db,
  ctx: TenantContext,
  room: Pick<LockedRoom, "id" | "propertyId">,
  type: "cleaning" | "inspection",
  reason: string,
  extra: { stayId?: string | null; notes?: string | null } = {},
) {
  const existing = await openTask(tx, ctx, room.id, type);
  if (existing) return existing;
  const [row] = await tx
    .insert(housekeepingTasks)
    .values({
      tenantId: ctx.tenantId,
      propertyId: room.propertyId,
      roomId: room.id,
      taskType: type,
      reason,
      stayId: extra.stayId ?? null,
      notes: extra.notes ?? null,
      createdByUserId: ctx.userId,
    })
    .onConflictDoNothing()
    .returning();
  return row ?? (await openTask(tx, ctx, room.id, type))!;
}

async function step<T>(db: Db, ctx: TenantContext, propertyId: string, roomId: string, fn: (tx: Db, room: LockedRoom) => Promise<T>) {
  const property = await requireProperty(db, ctx, propertyId, "housekeeping.manage", { write: true });
  try {
    return await db.transaction(async (tx) => fn(tx, await lockRoom(tx, ctx, property.id, roomId)));
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("Someone else just updated this room. Refresh and try again.");
    throw err;
  }
}

function audit(tx: Db, ctx: TenantContext, action: string, room: LockedRoom, metadata: Record<string, unknown> = {}) {
  return writeAudit(tx, {
    tenantId: ctx.tenantId,
    actorUserId: ctx.userId,
    actorType: "user",
    action,
    entityType: "room",
    entityId: room.id,
    metadata: { propertyId: room.propertyId, roomCode: room.roomCode, ...metadata },
  });
}

export async function startCleaning(db: Db, ctx: TenantContext, propertyId: string, roomId: string) {
  return step(db, ctx, propertyId, roomId, async (tx, room) => {
    if (room.housekeepingStatus === "blocked") throw conflict("This room is blocked.");
    if (room.housekeepingStatus === "in_progress") throw conflict("Cleaning is already in progress.");
    const task = await ensureTask(tx, ctx, room, "cleaning", "manual");
    await tx
      .update(housekeepingTasks)
      .set({ status: "in_progress", startedAt: new Date(), assignedUserId: task.assignedUserId ?? ctx.userId })
      .where(eq(housekeepingTasks.id, task.id));
    await setHousekeepingStatus(tx, ctx, room, "in_progress", "Cleaning started");
    await audit(tx, ctx, "housekeeping.cleaning_started", room);
  });
}

export async function finishCleaning(db: Db, ctx: TenantContext, propertyId: string, roomId: string, raw: { note?: string } = {}) {
  const note = optionalText(300).parse(raw.note);
  return step(db, ctx, propertyId, roomId, async (tx, room) => {
    const task = await openTask(tx, ctx, room.id, "cleaning");
    if (!task || room.housekeepingStatus !== "in_progress") throw conflict("Start cleaning first.");
    await tx
      .update(housekeepingTasks)
      .set({ status: "done", completedAt: new Date(), completedByUserId: ctx.userId, notes: note ?? task.notes })
      .where(eq(housekeepingTasks.id, task.id));
    await setHousekeepingStatus(tx, ctx, room, "clean", note ? `Cleaned: ${note}` : "Cleaned");
    if (room.requireInspection) await ensureTask(tx, ctx, room, "inspection", "after_cleaning");
    await audit(tx, ctx, "housekeeping.cleaning_completed", room, { inspectionRequired: room.requireInspection });
    return { requiresInspection: room.requireInspection };
  });
}

/**
 * Inspection. A housekeeper may not pass their own cleaning (separation of duties) unless
 * they can also manage rooms (supervisor/manager).
 */
export async function inspectRoom(
  db: Db,
  ctx: TenantContext,
  propertyId: string,
  roomId: string,
  raw: { passed: boolean; note?: string },
) {
  const note = optionalText(300).parse(raw.note);
  if (!raw.passed && !note) {
    throw new z.ZodError([{ code: "custom", path: ["note"], message: "Say what needs redoing", input: "" }]);
  }
  return step(db, ctx, propertyId, roomId, async (tx, room) => {
    if (room.housekeepingStatus !== "clean") throw conflict("Only a cleaned room can be inspected.");
    const [lastCleaning] = await tx
      .select({ completedBy: housekeepingTasks.completedByUserId })
      .from(housekeepingTasks)
      .where(and(eq(housekeepingTasks.roomId, room.id), eq(housekeepingTasks.taskType, "cleaning"), eq(housekeepingTasks.status, "done")))
      .orderBy(desc(housekeepingTasks.completedAt))
      .limit(1);
    if (lastCleaning?.completedBy === ctx.userId && !can(ctx, "room.manage", { propertyId: room.propertyId })) {
      throw forbidden("Someone other than the person who cleaned the room must inspect it.");
    }
    const task = await ensureTask(tx, ctx, room, "inspection", "manual");
    await tx
      .update(housekeepingTasks)
      .set({ status: "done", outcome: raw.passed ? "passed" : "failed", completedAt: new Date(), completedByUserId: ctx.userId, notes: note })
      .where(eq(housekeepingTasks.id, task.id));
    if (raw.passed) {
      await setHousekeepingStatus(tx, ctx, room, "inspected", note ? `Inspection passed: ${note}` : "Inspection passed");
    } else {
      await setHousekeepingStatus(tx, ctx, room, "dirty", `Inspection failed: ${note}`);
      await ensureTask(tx, ctx, room, "cleaning", "inspection_failed", { notes: note });
    }
    await audit(tx, ctx, raw.passed ? "housekeeping.inspection_passed" : "housekeeping.inspection_failed", room, { note });
  });
}

export async function setRequireInspection(db: Db, ctx: TenantContext, propertyId: string, value: boolean) {
  const property = await requireProperty(db, ctx, propertyId, "property.manage", { write: true });
  await db.transaction(async (tx) => {
    await tx.update(properties).set({ requireInspection: value }).where(and(eq(properties.id, property.id), eq(properties.tenantId, ctx.tenantId)));
    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      actorType: "user",
      action: "property.housekeeping_policy_changed",
      entityType: "property",
      entityId: property.id,
      metadata: { requireInspection: value },
    });
  });
}

const assignee = aliasedTable(users, "hk_assignee");

/**
 * Room readiness board. Everyone with room.view sees readiness; guest-identifying stay data
 * is NOT included (housekeeping does not need guest names).
 */
export async function readinessBoard(db: Db, ctx: TenantContext, propertyId: string) {
  const property = await requireProperty(db, ctx, propertyId, "room.view");
  const [{ requireInspection } = { requireInspection: true }] = await db
    .select({ requireInspection: properties.requireInspection })
    .from(properties)
    .where(eq(properties.id, property.id));
  const roomRows = await db
    .select({
      id: rooms.id,
      roomCode: rooms.roomCode,
      floorName: floors.name,
      operationalStatus: rooms.operationalStatus,
      housekeepingStatus: rooms.housekeepingStatus,
      expectedCheckoutAt: stays.expectedCheckoutAt,
      stayId: stays.id,
    })
    .from(rooms)
    .innerJoin(floors, eq(floors.id, rooms.floorId))
    .leftJoin(stays, and(eq(stays.roomId, rooms.id), eq(stays.status, "checked_in")))
    .where(and(eq(rooms.tenantId, ctx.tenantId), eq(rooms.propertyId, property.id), isNull(rooms.archivedAt)))
    .orderBy(asc(floors.sortOrder), ...roomNaturalOrder)
    .limit(2000);
  const tasks = await db
    .select({
      id: housekeepingTasks.id,
      roomId: housekeepingTasks.roomId,
      taskType: housekeepingTasks.taskType,
      status: housekeepingTasks.status,
      reason: housekeepingTasks.reason,
      notes: housekeepingTasks.notes,
      createdAt: housekeepingTasks.createdAt,
      assigneeName: assignee.name,
    })
    .from(housekeepingTasks)
    .leftJoin(assignee, eq(assignee.id, housekeepingTasks.assignedUserId))
    .where(
      and(
        eq(housekeepingTasks.tenantId, ctx.tenantId),
        eq(housekeepingTasks.propertyId, property.id),
        inArray(housekeepingTasks.status, ["open", "in_progress"]),
      ),
    );
  const items = roomRows.map((r) => ({
    ...r,
    occupied: Boolean(r.stayId),
    readiness: roomReadiness({
      ...r,
      occupied: Boolean(r.stayId),
      pendingInspection: tasks.some((t) => t.roomId === r.id && t.taskType === "inspection"),
    }),
    tasks: tasks.filter((t) => t.roomId === r.id),
  }));
  const counts = items.reduce<Record<string, number>>((acc, i) => ((acc[i.readiness] = (acc[i.readiness] ?? 0) + 1), acc), {});
  return { property, requireInspection, items, counts };
}
