import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/types";
import { departments, menuItems, serviceItems } from "@/lib/db/schema";
import { minorDigits } from "@/lib/money";
import { requestPriority, serviceKind, serviceNoteMode } from "@/lib/db/schema/enums";
import { notFound } from "@/lib/errors";
import type { TenantContext } from "@/lib/permissions/authorize";
import { nameSchema, optionalText } from "@/lib/validation/common";
import { writeAudit } from "@/modules/audit/service";
import { DEFAULT_DEPARTMENTS, departmentKey } from "@/modules/departments/service";
import { idSchema, requireProperty } from "@/modules/properties/access";
import { isForeignKeyViolation } from "@/modules/rooms/db-errors";

/** Icons the guest portal can render (kept in sync with components/service-icon.tsx). */
export const SERVICE_ICONS = [
  "bell",
  "glass-water",
  "sparkles",
  "concierge-bell",
  "wrench",
  "message-square",
  "utensils",
  "shirt",
  "shield",
  "flower",
  "car",
  "alarm-clock",
] as const;

type DefaultService = {
  key: string;
  name: string;
  description: string;
  department: (typeof DEFAULT_DEPARTMENTS)[number]["key"];
  icon: (typeof SERVICE_ICONS)[number];
  maxQuantity?: number;
  options?: string[];
  noteMode?: "none" | "optional" | "required";
  priority?: "low" | "normal" | "high" | "urgent";
  targetMinutes: number;
  ackMessage: string;
  enabled?: boolean;
  kind?: "request" | "menu" | "booking";
  availableFrom?: string;
  availableTo?: string;
  /** Sample menu (price in major units); hotels review prices before enabling. */
  menu?: { section?: string; name: string; price: number }[];
};

/** MVP services from Zprompt/04_SERVICE_REQUESTS.md. */
export const DEFAULT_SERVICES: DefaultService[] = [
  {
    key: "water",
    name: "Drinking water",
    description: "Bottled drinking water to your room.",
    department: "room_service",
    icon: "glass-water",
    maxQuantity: 6,
    targetMinutes: 15,
    ackMessage: "We'll bring it to your room shortly.",
  },
  {
    key: "housekeeping",
    name: "Housekeeping",
    description: "Room cleaning, towels, pillows or toiletries.",
    department: "housekeeping",
    icon: "sparkles",
    options: ["Clean my room", "Extra towels", "Extra pillows", "Toiletries"],
    targetMinutes: 30,
    ackMessage: "Housekeeping has your request.",
  },
  {
    key: "reception",
    name: "Reception assistance",
    description: "Ask the front desk for help.",
    department: "reception",
    icon: "concierge-bell",
    targetMinutes: 10,
    ackMessage: "Reception will get back to you shortly.",
  },
  {
    key: "maintenance",
    name: "Report a problem",
    description: "Air conditioning, TV, plumbing, lights or Wi-Fi.",
    department: "maintenance",
    icon: "wrench",
    options: ["Air conditioning", "TV", "Plumbing", "Lighting", "Wi-Fi", "Other"],
    priority: "high",
    targetMinutes: 30,
    ackMessage: "Our maintenance team has been informed.",
  },
  {
    key: "custom",
    name: "Something else",
    description: "Tell us what you need.",
    department: "reception",
    icon: "message-square",
    noteMode: "required",
    targetMinutes: 15,
    ackMessage: "We've received your message.",
    enabled: false,
  },
];

/**
 * Phase 9 module pack: dining, laundry, spa, transport and wake-up. Added HIDDEN, with sample
 * menus, so a hotel reviews names and prices before guests see them.
 */
export const MODULE_SERVICES: DefaultService[] = [
  {
    key: "dining",
    name: "In-room dining",
    description: "Order food and drinks to your room.",
    department: "room_service",
    icon: "utensils",
    kind: "menu",
    targetMinutes: 30,
    ackMessage: "The kitchen has your order.",
    enabled: false,
    menu: [
      { section: "Breakfast", name: "Masala omelette", price: 250 },
      { section: "Breakfast", name: "Idli sambar", price: 180 },
      { section: "Mains", name: "Veg thali", price: 450 },
      { section: "Mains", name: "Chicken biryani", price: 520 },
      { section: "Drinks", name: "Masala chai", price: 90 },
      { section: "Drinks", name: "Fresh lime soda", price: 120 },
    ],
  },
  {
    key: "laundry",
    name: "Laundry",
    description: "Washing and ironing, back within 24 hours.",
    department: "housekeeping",
    icon: "shirt",
    kind: "menu",
    targetMinutes: 60,
    ackMessage: "Housekeeping will collect your laundry.",
    enabled: false,
    menu: [
      { section: "Wash & iron", name: "Shirt", price: 80 },
      { section: "Wash & iron", name: "Trousers", price: 90 },
      { section: "Wash & iron", name: "Dress", price: 150 },
      { section: "Dry clean", name: "Suit (2 pieces)", price: 450 },
      { section: "Iron only", name: "Any garment", price: 40 },
    ],
  },
  {
    key: "spa",
    name: "Spa & wellness",
    description: "Book a treatment.",
    department: "reception",
    icon: "flower",
    kind: "booking",
    options: ["Full body massage (60 min)", "Head & shoulder massage (30 min)", "Foot reflexology (45 min)"],
    availableFrom: "09:00",
    availableTo: "21:00",
    targetMinutes: 30,
    ackMessage: "We'll confirm your treatment time shortly.",
    enabled: false,
  },
  {
    key: "transport",
    name: "Taxi & airport transfer",
    description: "Book a car for a time that suits you.",
    department: "reception",
    icon: "car",
    kind: "booking",
    options: ["Airport drop", "Airport pickup", "City taxi"],
    targetMinutes: 15,
    ackMessage: "Reception will confirm your car.",
    enabled: false,
  },
  {
    key: "wakeup",
    name: "Wake-up call",
    description: "We'll call your room at the time you choose.",
    department: "reception",
    icon: "alarm-clock",
    kind: "booking",
    noteMode: "none",
    targetMinutes: 60,
    ackMessage: "Your wake-up call is noted.",
    enabled: false,
  },
];

const time = z
  .string()
  .trim()
  .regex(/^$|^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MM")
  .optional()
  .transform((v) => (v ? v : null));

const checkbox = z
  .union([z.literal("on"), z.literal("true"), z.literal(""), z.boolean()])
  .optional()
  .transform((v) => v === true || v === "on" || v === "true");

export const serviceInputSchema = z
  .object({
    name: nameSchema("Service name", 60),
    description: optionalText(200),
    departmentId: idSchema("department"),
    icon: z.enum(SERVICE_ICONS).default("bell").catch("bell"),
    enabled: checkbox,
    maxQuantity: z.coerce.number().int().min(0, "0 = no quantity").max(20).default(0),
    // One choice per line in the admin form.
    options: z
      .string()
      .max(1000)
      .optional()
      .transform((v) =>
        [...new Set((v ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean))],
      )
      .refine((list) => list.length <= 12, "Up to 12 choices")
      .refine((list) => list.every((s) => s.length <= 40), "Each choice up to 40 characters"),
    noteMode: z.enum(serviceNoteMode.enumValues).default("optional"),
    kind: z.enum(serviceKind.enumValues).default("request").catch("request"),
    allowRoomCharge: checkbox,
    availableFrom: time,
    availableTo: time,
    ackMessage: optionalText(200),
    priority: z.enum(requestPriority.enumValues).default("normal"),
    targetMinutes: z.coerce.number().int().min(1).max(1440).default(15),
    escalate: checkbox,
    sortOrder: z.coerce.number().int().min(0).max(999).default(0),
  })
  .refine((v) => (v.availableFrom === null) === (v.availableTo === null), {
    path: ["availableTo"],
    message: "Set both times, or neither for all day",
  });
export type ServiceInput = z.input<typeof serviceInputSchema>;

/** Local HH:MM of `now` in a timezone. */
export function localTime(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const h = parts.find((p) => p.type === "hour")!.value;
  const m = parts.find((p) => p.type === "minute")!.value;
  return `${h}:${m}`;
}

/** Inclusive start, exclusive end; supports overnight windows such as 22:00–06:00. */
export function isAvailableAt(
  item: { availableFrom: string | null; availableTo: string | null },
  timeZone: string,
  now: Date = new Date(),
): boolean {
  if (!item.availableFrom || !item.availableTo) return true;
  const t = localTime(now, timeZone);
  const { availableFrom: from, availableTo: to } = item;
  return from <= to ? t >= from && t < to : t >= from || t < to;
}

export async function listServices(db: Db, ctx: TenantContext, propertyId: string) {
  const property = await requireProperty(db, ctx, propertyId, "property.view");
  const rows = await db
    .select({ service: serviceItems, departmentName: departments.name, departmentStatus: departments.status })
    .from(serviceItems)
    .innerJoin(departments, eq(departments.id, serviceItems.departmentId))
    .where(and(eq(serviceItems.tenantId, ctx.tenantId), eq(serviceItems.propertyId, property.id), isNull(serviceItems.archivedAt)))
    .orderBy(asc(serviceItems.sortOrder), asc(serviceItems.name));
  return { property, items: rows.map((r) => ({ ...r.service, departmentName: r.departmentName, departmentStatus: r.departmentStatus })) };
}

/** Adds the standard departments and services that are missing. Idempotent. */
export async function createDefaultServices(db: Db, ctx: TenantContext, propertyId: string) {
  return addServicePack(db, ctx, propertyId, DEFAULT_SERVICES, "service.defaults_created");
}

/** Adds the dining/laundry/spa/transport/wake-up pack (hidden, with sample menus). Idempotent. */
export async function createModuleServices(db: Db, ctx: TenantContext, propertyId: string) {
  return addServicePack(db, ctx, propertyId, MODULE_SERVICES, "service.modules_created");
}

async function addServicePack(db: Db, ctx: TenantContext, propertyId: string, pack: DefaultService[], auditAction: string) {
  const property = await requireProperty(db, ctx, propertyId, "service.manage", { write: true });
  return db.transaction(async (tx) => {
    await tx
      .insert(departments)
      .values(DEFAULT_DEPARTMENTS.map((d) => ({ ...d, tenantId: ctx.tenantId, propertyId: property.id })))
      .onConflictDoNothing();
    const depts = await tx
      .select({ id: departments.id, key: departments.key })
      .from(departments)
      .where(and(eq(departments.tenantId, ctx.tenantId), eq(departments.propertyId, property.id)));
    const byKey = new Map(depts.map((d) => [d.key, d.id]));
    // A department renamed to clash with a default name keeps its own key; skip those services.
    const services = pack.filter((s) => byKey.has(s.department));
    if (services.length === 0) return { count: 0 };
    const created = await tx
      .insert(serviceItems)
      .values(
        services.map((s, i) => ({
          tenantId: ctx.tenantId,
          propertyId: property.id,
          departmentId: byKey.get(s.department)!,
          key: s.key,
          name: s.name,
          description: s.description,
          icon: s.icon,
          enabled: s.enabled ?? true,
          sortOrder: (i + 1) * 10 + (pack === DEFAULT_SERVICES ? 0 : 100),
          kind: s.kind ?? "request",
          availableFrom: s.availableFrom ?? null,
          availableTo: s.availableTo ?? null,
          maxQuantity: s.maxQuantity ?? 0,
          options: s.options ?? [],
          noteMode: s.noteMode ?? "optional",
          ackMessage: s.ackMessage,
          priority: s.priority ?? "normal",
          targetMinutes: s.targetMinutes,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: serviceItems.id, key: serviceItems.key });
    const scale = 10 ** minorDigits(property.currency);
    for (const row of created) {
      const menu = pack.find((s) => s.key === row.key)?.menu ?? [];
      if (menu.length === 0) continue;
      await tx.insert(menuItems).values(
        menu.map((m, i) => ({
          tenantId: ctx.tenantId,
          propertyId: property.id,
          serviceItemId: row.id,
          section: m.section ?? null,
          name: m.name,
          priceMinor: Math.round(m.price * scale),
          sortOrder: (i + 1) * 10,
        })),
      );
    }
    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      actorType: "user",
      action: auditAction,
      entityType: "property",
      entityId: property.id,
      metadata: { count: created.length },
    });
    return { count: created.length };
  });
}

async function assertDepartment(db: Db, ctx: TenantContext, propertyId: string, departmentId: string) {
  const [d] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.id, departmentId), eq(departments.propertyId, propertyId), eq(departments.tenantId, ctx.tenantId)));
  if (!d) throw new z.ZodError([{ code: "custom", path: ["departmentId"], message: "Choose a department of this property", input: departmentId }]);
}

export async function createService(db: Db, ctx: TenantContext, propertyId: string, raw: ServiceInput) {
  const property = await requireProperty(db, ctx, propertyId, "service.manage", { write: true });
  const input = serviceInputSchema.parse(raw);
  await assertDepartment(db, ctx, property.id, input.departmentId);
  const key = `${departmentKey(input.name).slice(0, 30)}_${crypto.randomUUID().slice(0, 6)}`;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(serviceItems)
      .values({ ...input, key, tenantId: ctx.tenantId, propertyId: property.id })
      .returning();
    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      actorType: "user",
      action: "service.created",
      entityType: "service_item",
      entityId: row.id,
      metadata: { propertyId: property.id, name: row.name },
    });
    return row;
  });
}

async function getService(db: Db, ctx: TenantContext, propertyId: string, serviceId: string) {
  const id = z.uuid().safeParse(serviceId);
  if (!id.success) throw notFound("Service not found.");
  const [row] = await db
    .select()
    .from(serviceItems)
    .where(
      and(
        eq(serviceItems.id, id.data),
        eq(serviceItems.propertyId, propertyId),
        eq(serviceItems.tenantId, ctx.tenantId),
        isNull(serviceItems.archivedAt),
      ),
    );
  if (!row) throw notFound("Service not found.");
  return row;
}

export async function updateService(db: Db, ctx: TenantContext, propertyId: string, serviceId: string, raw: ServiceInput) {
  const property = await requireProperty(db, ctx, propertyId, "service.manage", { write: true });
  const existing = await getService(db, ctx, property.id, serviceId);
  const input = serviceInputSchema.parse(raw);
  await assertDepartment(db, ctx, property.id, input.departmentId);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .update(serviceItems)
        .set(input)
        .where(and(eq(serviceItems.id, existing.id), eq(serviceItems.tenantId, ctx.tenantId)))
        .returning();
      await writeAudit(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        actorType: "user",
        action: "service.updated",
        entityType: "service_item",
        entityId: row.id,
        metadata: { propertyId: property.id, name: row.name, enabled: row.enabled },
      });
      return row;
    });
  } catch (err) {
    if (isForeignKeyViolation(err)) throw notFound("Department not found.");
    throw err;
  }
}

export async function archiveService(db: Db, ctx: TenantContext, propertyId: string, serviceId: string) {
  const property = await requireProperty(db, ctx, propertyId, "service.manage", { write: true });
  const existing = await getService(db, ctx, property.id, serviceId);
  await db.transaction(async (tx) => {
    await tx
      .update(serviceItems)
      .set({ archivedAt: sql`now()`, enabled: false })
      .where(and(eq(serviceItems.id, existing.id), eq(serviceItems.tenantId, ctx.tenantId)));
    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      actorType: "user",
      action: "service.archived",
      entityType: "service_item",
      entityId: existing.id,
      metadata: { propertyId: property.id, name: existing.name },
    });
  });
}

/** Guest-safe tiles for a property: enabled services whose department is active. */
export async function listGuestServices(db: Db, scope: { tenantId: string; propertyId: string; timezone: string }) {
  const rows = await db
    .select({
      id: serviceItems.id,
      name: serviceItems.name,
      description: serviceItems.description,
      icon: serviceItems.icon,
      kind: serviceItems.kind,
      allowRoomCharge: serviceItems.allowRoomCharge,
      maxQuantity: serviceItems.maxQuantity,
      options: serviceItems.options,
      noteMode: serviceItems.noteMode,
      availableFrom: serviceItems.availableFrom,
      availableTo: serviceItems.availableTo,
    })
    .from(serviceItems)
    .innerJoin(departments, eq(departments.id, serviceItems.departmentId))
    .where(
      and(
        eq(serviceItems.tenantId, scope.tenantId),
        eq(serviceItems.propertyId, scope.propertyId),
        eq(serviceItems.enabled, true),
        isNull(serviceItems.archivedAt),
        eq(departments.status, "active"),
      ),
    )
    .orderBy(asc(serviceItems.sortOrder), asc(serviceItems.name));
  const now = new Date();
  return rows.map((r) => ({ ...r, availableNow: isAvailableAt(r, scope.timezone, now) }));
}
