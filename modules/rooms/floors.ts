import { and, asc, count, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/types";
import { floors, rooms } from "@/lib/db/schema";
import { conflict, notFound } from "@/lib/errors";
import type { TenantContext } from "@/lib/permissions/authorize";
import { nameSchema } from "@/lib/validation/common";
import { writeAudit } from "@/modules/audit/service";
import { requireProperty } from "@/modules/properties/access";
import { isUniqueViolation } from "./db-errors";

export const floorInputSchema = z.object({
  name: nameSchema("Floor name", 60),
  sortOrder: z.coerce.number().int().min(-20).max(500).default(0),
});
export type FloorInput = z.input<typeof floorInputSchema>;

export async function listFloors(db: Db, ctx: TenantContext, propertyId: string, opts: { includeArchived?: boolean } = {}) {
  const property = await requireProperty(db, ctx, propertyId, "room.view");
  const roomCounts = db
    .select({ floorId: rooms.floorId, n: count().as("n") })
    .from(rooms)
    .where(and(eq(rooms.tenantId, ctx.tenantId), eq(rooms.propertyId, property.id), isNull(rooms.archivedAt)))
    .groupBy(rooms.floorId)
    .as("rc");
  return db
    .select({
      id: floors.id,
      name: floors.name,
      sortOrder: floors.sortOrder,
      archivedAt: floors.archivedAt,
      roomCount: roomCounts.n,
    })
    .from(floors)
    .leftJoin(roomCounts, eq(roomCounts.floorId, floors.id))
    .where(
      and(
        eq(floors.tenantId, ctx.tenantId),
        eq(floors.propertyId, property.id),
        opts.includeArchived ? undefined : isNull(floors.archivedAt),
      ),
    )
    .orderBy(asc(floors.sortOrder), asc(floors.name));
}

async function getFloor(db: Db, ctx: TenantContext, propertyId: string, floorId: string) {
  const id = z.uuid().safeParse(floorId);
  if (!id.success) throw notFound("Floor not found.");
  const [row] = await db
    .select()
    .from(floors)
    .where(and(eq(floors.id, id.data), eq(floors.propertyId, propertyId), eq(floors.tenantId, ctx.tenantId)));
  if (!row) throw notFound("Floor not found.");
  return row;
}

const DUPLICATE = "A floor with this name already exists in this property.";

export async function createFloor(db: Db, ctx: TenantContext, propertyId: string, raw: FloorInput) {
  const property = await requireProperty(db, ctx, propertyId, "room.manage", { write: true });
  const input = floorInputSchema.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(floors)
        .values({ ...input, tenantId: ctx.tenantId, propertyId: property.id })
        .returning();
      await writeAudit(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        actorType: "user",
        action: "floor.created",
        entityType: "floor",
        entityId: row.id,
        metadata: { propertyId: property.id, name: row.name },
      });
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict(DUPLICATE);
    throw err;
  }
}

export async function updateFloor(db: Db, ctx: TenantContext, propertyId: string, floorId: string, raw: FloorInput) {
  const property = await requireProperty(db, ctx, propertyId, "room.manage", { write: true });
  const floor = await getFloor(db, ctx, property.id, floorId);
  const input = floorInputSchema.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.update(floors).set(input).where(eq(floors.id, floor.id)).returning();
      await writeAudit(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        actorType: "user",
        action: "floor.updated",
        entityType: "floor",
        entityId: row.id,
        metadata: { propertyId: property.id, from: floor.name, to: row.name },
      });
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict(DUPLICATE);
    throw err;
  }
}

/** Archive is refused while live rooms are on the floor, so no room is left orphaned. */
export async function setFloorArchived(db: Db, ctx: TenantContext, propertyId: string, floorId: string, archived: boolean) {
  const property = await requireProperty(db, ctx, propertyId, "room.manage", { write: true });
  const floor = await getFloor(db, ctx, property.id, floorId);
  try {
    return await db.transaction(async (tx) => {
      if (archived) {
        const [{ n }] = await tx
          .select({ n: count() })
          .from(rooms)
          .where(and(eq(rooms.floorId, floor.id), eq(rooms.tenantId, ctx.tenantId), isNull(rooms.archivedAt)));
        if (n > 0) throw conflict(`Move or archive the ${n} room(s) on this floor first.`);
      }
      const [row] = await tx
        .update(floors)
        .set({ archivedAt: archived ? new Date() : null })
        .where(eq(floors.id, floor.id))
        .returning();
      await writeAudit(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        actorType: "user",
        action: archived ? "floor.archived" : "floor.restored",
        entityType: "floor",
        entityId: floor.id,
        metadata: { propertyId: property.id, name: floor.name },
      });
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("A live floor already uses this name. Rename it first.");
    throw err;
  }
}
