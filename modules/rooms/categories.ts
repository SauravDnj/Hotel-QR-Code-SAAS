import { and, asc, count, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/types";
import { roomCategories, rooms } from "@/lib/db/schema";
import { conflict, notFound } from "@/lib/errors";
import type { TenantContext } from "@/lib/permissions/authorize";
import { nameSchema, optionalText } from "@/lib/validation/common";
import { writeAudit } from "@/modules/audit/service";
import { requireProperty } from "@/modules/properties/access";
import { isUniqueViolation } from "./db-errors";

export const categoryInputSchema = z.object({
  name: nameSchema("Room type name", 80),
  description: optionalText(500),
  capacity: z.coerce.number().int("Capacity must be a whole number").min(1, "At least 1 guest").max(50),
});
export type CategoryInput = z.input<typeof categoryInputSchema>;

export async function listCategories(db: Db, ctx: TenantContext, propertyId: string, opts: { includeArchived?: boolean } = {}) {
  const property = await requireProperty(db, ctx, propertyId, "room.view");
  const roomCounts = db
    .select({ categoryId: rooms.categoryId, n: count().as("n") })
    .from(rooms)
    .where(and(eq(rooms.tenantId, ctx.tenantId), eq(rooms.propertyId, property.id), isNull(rooms.archivedAt)))
    .groupBy(rooms.categoryId)
    .as("rc");
  return db
    .select({
      id: roomCategories.id,
      name: roomCategories.name,
      description: roomCategories.description,
      capacity: roomCategories.capacity,
      archivedAt: roomCategories.archivedAt,
      roomCount: roomCounts.n,
    })
    .from(roomCategories)
    .leftJoin(roomCounts, eq(roomCounts.categoryId, roomCategories.id))
    .where(
      and(
        eq(roomCategories.tenantId, ctx.tenantId),
        eq(roomCategories.propertyId, property.id),
        opts.includeArchived ? undefined : isNull(roomCategories.archivedAt),
      ),
    )
    .orderBy(asc(roomCategories.name));
}

async function getCategory(db: Db, ctx: TenantContext, propertyId: string, categoryId: string) {
  const id = z.uuid().safeParse(categoryId);
  if (!id.success) throw notFound("Room type not found.");
  const [row] = await db
    .select()
    .from(roomCategories)
    .where(
      and(
        eq(roomCategories.id, id.data),
        eq(roomCategories.propertyId, propertyId),
        eq(roomCategories.tenantId, ctx.tenantId),
      ),
    );
  if (!row) throw notFound("Room type not found.");
  return row;
}

const DUPLICATE = "A room type with this name already exists in this property.";

export async function createCategory(db: Db, ctx: TenantContext, propertyId: string, raw: CategoryInput) {
  const property = await requireProperty(db, ctx, propertyId, "room.manage", { write: true });
  const input = categoryInputSchema.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(roomCategories)
        .values({ ...input, tenantId: ctx.tenantId, propertyId: property.id })
        .returning();
      await writeAudit(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        actorType: "user",
        action: "room_category.created",
        entityType: "room_category",
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

export async function updateCategory(
  db: Db,
  ctx: TenantContext,
  propertyId: string,
  categoryId: string,
  raw: CategoryInput,
) {
  const property = await requireProperty(db, ctx, propertyId, "room.manage", { write: true });
  const category = await getCategory(db, ctx, property.id, categoryId);
  const input = categoryInputSchema.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.update(roomCategories).set(input).where(eq(roomCategories.id, category.id)).returning();
      await writeAudit(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        actorType: "user",
        action: "room_category.updated",
        entityType: "room_category",
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

export async function setCategoryArchived(
  db: Db,
  ctx: TenantContext,
  propertyId: string,
  categoryId: string,
  archived: boolean,
) {
  const property = await requireProperty(db, ctx, propertyId, "room.manage", { write: true });
  const category = await getCategory(db, ctx, property.id, categoryId);
  try {
    return await db.transaction(async (tx) => {
      if (archived) {
        const [{ n }] = await tx
          .select({ n: count() })
          .from(rooms)
          .where(and(eq(rooms.categoryId, category.id), eq(rooms.tenantId, ctx.tenantId), isNull(rooms.archivedAt)));
        if (n > 0) throw conflict(`Change the room type of the ${n} room(s) using it first.`);
      }
      const [row] = await tx
        .update(roomCategories)
        .set({ archivedAt: archived ? new Date() : null })
        .where(eq(roomCategories.id, category.id))
        .returning();
      await writeAudit(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        actorType: "user",
        action: archived ? "room_category.archived" : "room_category.restored",
        entityType: "room_category",
        entityId: category.id,
        metadata: { propertyId: property.id, name: category.name },
      });
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("A live room type already uses this name. Rename it first.");
    throw err;
  }
}
