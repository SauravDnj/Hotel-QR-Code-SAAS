import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/types";
import { housekeepingTasks, properties, rooms, roomStatusHistory, stays } from "@/lib/db/schema";
import type { HousekeepingStatus } from "@/lib/db/schema/enums";
import { notFound } from "@/lib/errors";
import type { TenantContext } from "@/lib/permissions/authorize";

/**
 * Locks a live room of the caller's tenant/property (SELECT … FOR UPDATE) for the rest of the
 * transaction, so check-in, check-out and housekeeping steps on one room are serialised.
 */
export async function lockRoom(tx: Db, ctx: TenantContext, propertyId: string, roomId: string) {
  const id = z.uuid().safeParse(roomId);
  if (!id.success) throw notFound("Room not found.");
  const [room] = await tx
    .select({
      id: rooms.id,
      propertyId: rooms.propertyId,
      roomCode: rooms.roomCode,
      operationalStatus: rooms.operationalStatus,
      housekeepingStatus: rooms.housekeepingStatus,
    })
    .from(rooms)
    .where(and(eq(rooms.id, id.data), eq(rooms.propertyId, propertyId), eq(rooms.tenantId, ctx.tenantId), isNull(rooms.archivedAt)))
    .for("update");
  if (!room) throw notFound("Room not found.");
  const [[active], [property], openTasks] = await Promise.all([
    tx.select({ id: stays.id }).from(stays).where(and(eq(stays.roomId, room.id), eq(stays.status, "checked_in"))),
    tx.select({ requireInspection: properties.requireInspection }).from(properties).where(eq(properties.id, propertyId)),
    tx
      .select({ taskType: housekeepingTasks.taskType })
      .from(housekeepingTasks)
      .where(and(eq(housekeepingTasks.roomId, room.id), inArray(housekeepingTasks.status, ["open", "in_progress"]))),
  ]);
  return {
    ...room,
    occupied: Boolean(active),
    activeStayId: active?.id ?? null,
    requireInspection: property?.requireInspection ?? true,
    pendingInspection: openTasks.some((t) => t.taskType === "inspection"),
    openTaskTypes: openTasks.map((t) => t.taskType),
  };
}

/** Changes housekeeping status with an immutable history row (same table as manual changes). */
export async function setHousekeepingStatus(
  tx: Db,
  ctx: TenantContext,
  room: { id: string; propertyId: string; housekeepingStatus: HousekeepingStatus },
  to: HousekeepingStatus,
  note: string,
) {
  if (room.housekeepingStatus === to) return;
  await tx.update(rooms).set({ housekeepingStatus: to }).where(and(eq(rooms.id, room.id), eq(rooms.tenantId, ctx.tenantId)));
  await tx.insert(roomStatusHistory).values({
    tenantId: ctx.tenantId,
    propertyId: room.propertyId,
    roomId: room.id,
    dimension: "housekeeping",
    fromStatus: room.housekeepingStatus,
    toStatus: to,
    actorUserId: ctx.userId,
    note,
  });
  room.housekeepingStatus = to;
}
