import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/types";
import { plans, type Entitlements } from "@/lib/db/schema";
import { notFound } from "@/lib/errors";
import { writeAudit } from "@/modules/audit/service";
import type { PlatformActor } from "@/modules/platform/service";
import { forbidden } from "@/lib/errors";

/**
 * Starting catalogue, inserted ONCE by `pnpm db:seed` if a plan key is missing. After that
 * the database is authoritative: SaaS operators edit prices/limits in the platform console,
 * and code only ever reads `plans.entitlements` (SAAS_BILLING.md: do not hardcode limits).
 */
export const STARTER_PLANS: {
  key: string;
  name: string;
  description: string;
  priceMinor: number;
  entitlements: Entitlements;
  isDefault?: boolean;
  sortOrder: number;
}[] = [
  {
    key: "starter",
    name: "Starter",
    description: "Small hotels and guest houses.",
    priceMinor: 1999_00,
    entitlements: { maxRooms: 25, maxProperties: 1, maxStaffSeats: 10, modules: { reports: false, integrations: false } },
    sortOrder: 10,
  },
  {
    key: "professional",
    name: "Professional",
    description: "Mid-size hotels: more rooms, reports and escalation.",
    priceMinor: 5999_00,
    entitlements: { maxRooms: 120, maxProperties: 3, maxStaffSeats: 60, modules: { reports: true, integrations: true } },
    isDefault: true,
    sortOrder: 20,
  },
  {
    key: "enterprise",
    name: "Enterprise",
    description: "Hotel groups and resorts.",
    priceMinor: 19999_00,
    entitlements: { maxRooms: 1000, maxProperties: 25, maxStaffSeats: 500, modules: { reports: true, integrations: true } },
    sortOrder: 30,
  },
];

export async function seedPlans(db: Db) {
  for (const p of STARTER_PLANS) {
    await db
      .insert(plans)
      .values({ ...p, isDefault: p.isDefault ?? false })
      .onConflictDoNothing({ target: plans.key });
  }
}

export async function listActivePlans(db: Db) {
  return db.select().from(plans).where(eq(plans.active, true)).orderBy(asc(plans.sortOrder));
}

// ---------------------------------------------------------------- platform console

const limit = (max: number) => z.coerce.number().int().min(0).max(max);

export const planUpdateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(200).optional(),
  priceMinor: limit(100_000_000),
  razorpayPlanId: z
    .string()
    .trim()
    .regex(/^$|^plan_[A-Za-z0-9]{6,40}$/, "Razorpay plan ids look like plan_XXXXXXXX")
    .optional()
    .transform((v) => (v ? v : null)),
  maxRooms: limit(100_000),
  maxProperties: limit(10_000),
  maxStaffSeats: limit(100_000),
  reports: z
    .union([z.literal("on"), z.literal(""), z.boolean()])
    .optional()
    .transform((v) => v === true || v === "on"),
  integrations: z
    .union([z.literal("on"), z.literal(""), z.boolean()])
    .optional()
    .transform((v) => v === true || v === "on"),
  trialDays: limit(365),
  active: z
    .union([z.literal("on"), z.literal(""), z.boolean()])
    .optional()
    .transform((v) => v === true || v === "on"),
});

export async function updatePlan(db: Db, actor: PlatformActor, planId: string, raw: z.input<typeof planUpdateSchema>) {
  if (!actor.isPlatformAdmin) throw forbidden();
  const input = planUpdateSchema.parse(raw);
  const id = z.uuid().safeParse(planId);
  if (!id.success) throw notFound("Plan not found.");
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(plans)
      .set({
        name: input.name,
        description: input.description ?? null,
        priceMinor: input.priceMinor,
        razorpayPlanId: input.razorpayPlanId,
        trialDays: input.trialDays,
        active: input.active,
        entitlements: {
          maxRooms: input.maxRooms,
          maxProperties: input.maxProperties,
          maxStaffSeats: input.maxStaffSeats,
          modules: { reports: input.reports, integrations: input.integrations },
        },
      })
      .where(eq(plans.id, id.data))
      .returning({ id: plans.id, key: plans.key });
    if (!row) throw notFound("Plan not found.");
    await writeAudit(tx, {
      tenantId: null,
      actorUserId: actor.userId,
      actorType: "platform_admin",
      action: "platform.plan_updated",
      entityType: "plan",
      entityId: row.id,
      metadata: { key: row.key, ...input },
    });
  });
}
