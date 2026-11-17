import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/types";
import { menuItems, serviceItems } from "@/lib/db/schema";
import { conflict, notFound } from "@/lib/errors";
import type { TenantContext } from "@/lib/permissions/authorize";
import { moneySchema } from "@/lib/money";
import { nameSchema, optionalText } from "@/lib/validation/common";
import { writeAudit } from "@/modules/audit/service";
import { requireProperty } from "@/modules/properties/access";
import { isUniqueViolation } from "@/modules/rooms/db-errors";

/**
 * Menus for "menu" services (in-room dining, laundry price list). Managed with
 * service.manage; guests see only available, live items of an enabled service.
 */

export const MAX_MENU_ITEMS = 150;

const checkbox = z
  .union([z.literal("on"), z.literal("true"), z.literal(""), z.boolean()])
  .optional()
  .transform((v) => v === true || v === "on" || v === "true");

export const menuItemSchema = (currency: string) =>
  z.object({
    section: optionalText(40),
    name: nameSchema("Item name", 80),
    description: optionalText(200),
    price: moneySchema(currency),
    available: checkbox,
    sortOrder: z.coerce.number().int().min(0).max(999).default(0),
  });
export type MenuItemInput = { section?: string; name: string; description?: string; price: string; available?: string | boolean; sortOrder?: string | number };

async function menuService(db: Db, ctx: TenantContext, propertyId: string, serviceId: string) {
  const id = z.uuid().safeParse(serviceId);
  if (!id.success) throw notFound("Service not found.");
  const [svc] = await db
    .select({ id: serviceItems.id, name: serviceItems.name, kind: serviceItems.kind })
    .from(serviceItems)
    .where(
      and(
        eq(serviceItems.id, id.data),
        eq(serviceItems.propertyId, propertyId),
        eq(serviceItems.tenantId, ctx.tenantId),
        isNull(serviceItems.archivedAt),
      ),
    );
  if (!svc) throw notFound("Service not found.");
  if (svc.kind !== "menu") throw conflict("Only menu services have items. Change the service type to Menu first.");
  return svc;
}

export async function listMenu(db: Db, ctx: TenantContext, propertyId: string, serviceId: string) {
  const property = await requireProperty(db, ctx, propertyId, "property.view");
  const service = await menuService(db, ctx, property.id, serviceId);
  const items = await db
    .select()
    .from(menuItems)
    .where(and(eq(menuItems.tenantId, ctx.tenantId), eq(menuItems.serviceItemId, service.id), isNull(menuItems.archivedAt)))
    .orderBy(asc(menuItems.sortOrder), asc(menuItems.section), asc(menuItems.name));
  return { property, service, items };
}

export async function createMenuItem(db: Db, ctx: TenantContext, propertyId: string, serviceId: string, raw: MenuItemInput) {
  const property = await requireProperty(db, ctx, propertyId, "service.manage", { write: true });
  const service = await menuService(db, ctx, property.id, serviceId);
  const input = menuItemSchema(property.currency).parse(raw);
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(menuItems)
    .where(and(eq(menuItems.serviceItemId, service.id), isNull(menuItems.archivedAt)));
  if (n >= MAX_MENU_ITEMS) throw conflict(`A menu can have up to ${MAX_MENU_ITEMS} items.`);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(menuItems)
        .values({
          tenantId: ctx.tenantId,
          propertyId: property.id,
          serviceItemId: service.id,
          section: input.section,
          name: input.name,
          description: input.description,
          priceMinor: input.price,
          available: input.available,
          sortOrder: input.sortOrder,
        })
        .returning();
      await writeAudit(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        actorType: "user",
        action: "menu_item.created",
        entityType: "menu_item",
        entityId: row.id,
        metadata: { propertyId: property.id, serviceId: service.id, name: row.name, priceMinor: row.priceMinor },
      });
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("An item with this name is already on the menu.");
    throw err;
  }
}

export async function updateMenuItem(db: Db, ctx: TenantContext, propertyId: string, itemId: string, raw: MenuItemInput) {
  const property = await requireProperty(db, ctx, propertyId, "service.manage", { write: true });
  const existing = await getMenuItem(db, ctx, property.id, itemId);
  const input = menuItemSchema(property.currency).parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .update(menuItems)
        .set({
          section: input.section,
          name: input.name,
          description: input.description,
          priceMinor: input.price,
          available: input.available,
          sortOrder: input.sortOrder,
        })
        .where(and(eq(menuItems.id, existing.id), eq(menuItems.tenantId, ctx.tenantId)))
        .returning();
      await writeAudit(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        actorType: "user",
        action: "menu_item.updated",
        entityType: "menu_item",
        entityId: row.id,
        metadata: { propertyId: property.id, name: row.name, priceMinor: row.priceMinor, available: row.available },
      });
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("An item with this name is already on the menu.");
    throw err;
  }
}

export async function archiveMenuItem(db: Db, ctx: TenantContext, propertyId: string, itemId: string) {
  const property = await requireProperty(db, ctx, propertyId, "service.manage", { write: true });
  const existing = await getMenuItem(db, ctx, property.id, itemId);
  await db.transaction(async (tx) => {
    await tx.update(menuItems).set({ archivedAt: new Date(), available: false }).where(eq(menuItems.id, existing.id));
    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      actorType: "user",
      action: "menu_item.archived",
      entityType: "menu_item",
      entityId: existing.id,
      metadata: { propertyId: property.id, name: existing.name },
    });
  });
}

async function getMenuItem(db: Db, ctx: TenantContext, propertyId: string, itemId: string) {
  const id = z.uuid().safeParse(itemId);
  if (!id.success) throw notFound("Menu item not found.");
  const [row] = await db
    .select()
    .from(menuItems)
    .where(and(eq(menuItems.id, id.data), eq(menuItems.propertyId, propertyId), eq(menuItems.tenantId, ctx.tenantId), isNull(menuItems.archivedAt)));
  if (!row) throw notFound("Menu item not found.");
  return row;
}

/** Guest-safe menu: available live items only, no internal fields. */
export async function listGuestMenu(db: Db, scope: { tenantId: string; propertyId: string; serviceItemId: string }) {
  return db
    .select({
      id: menuItems.id,
      section: menuItems.section,
      name: menuItems.name,
      description: menuItems.description,
      priceMinor: menuItems.priceMinor,
    })
    .from(menuItems)
    .where(
      and(
        eq(menuItems.tenantId, scope.tenantId),
        eq(menuItems.propertyId, scope.propertyId),
        eq(menuItems.serviceItemId, scope.serviceItemId),
        eq(menuItems.available, true),
        isNull(menuItems.archivedAt),
      ),
    )
    .orderBy(asc(menuItems.sortOrder), asc(menuItems.section), asc(menuItems.name));
}

/** Prices the requested lines from the database (never from the client). */
export async function priceOrder(
  db: Db,
  scope: { tenantId: string; propertyId: string; serviceItemId: string },
  lines: { menuItemId: string; quantity: number }[],
) {
  const ids = [...new Set(lines.map((l) => l.menuItemId))];
  const rows = ids.length
    ? await db
        .select({ id: menuItems.id, name: menuItems.name, priceMinor: menuItems.priceMinor })
        .from(menuItems)
        .where(
          and(
            eq(menuItems.tenantId, scope.tenantId),
            eq(menuItems.propertyId, scope.propertyId),
            eq(menuItems.serviceItemId, scope.serviceItemId),
            eq(menuItems.available, true),
            isNull(menuItems.archivedAt),
            inArray(menuItems.id, ids),
          ),
        )
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  if (rows.length !== ids.length) return null; // an item was removed or is sold out
  const priced = lines.map((l) => {
    const item = byId.get(l.menuItemId)!;
    return { menuItemId: item.id, name: item.name, unitPriceMinor: item.priceMinor, quantity: l.quantity, lineTotalMinor: item.priceMinor * l.quantity };
  });
  return { lines: priced, totalMinor: priced.reduce((s, l) => s + l.lineTotalMinor, 0) };
}
