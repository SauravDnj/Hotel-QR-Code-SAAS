import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/types";
import { folioCharges, folioPayments, guests, rooms, serviceRequests, stays } from "@/lib/db/schema";
import { conflict, notFound } from "@/lib/errors";
import type { TenantContext } from "@/lib/permissions/authorize";
import { minorDigits, moneySchema } from "@/lib/money";
import { nameSchema, optionalText } from "@/lib/validation/common";
import { writeAudit } from "@/modules/audit/service";
import { requireProperty } from "@/modules/properties/access";
import { isUniqueViolation } from "@/modules/rooms/db-errors";

/**
 * Guest bill (folio) per stay (Phase 9). Charges come from room-charged orders (posted once,
 * on completion), from reception (manual) or from integrations (POS). Charges are voided with
 * a reason, never deleted; payments record how the bill was settled (cash/card/UPI…). No card
 * data is ever stored: card/UPI payments are taken on the hotel's own terminal.
 */

export const PAYMENT_METHODS = ["cash", "card", "upi", "bank", "other"] as const;

export interface ChargeActor {
  userId: string | null;
  actorType: "user" | "api_key" | "system";
  apiKeyId?: string;
}

/** Called inside the completion transition of a room-charged order. Idempotent per request. */
export async function postOrderCharge(
  tx: Db,
  r: { id: string; tenantId: string; propertyId: string; stayId: string | null; paymentMethod: string | null; totalMinor: number | null; serviceName: string; roomCode: string },
  actorUserId: string,
) {
  if (r.paymentMethod !== "room" || !r.stayId || !r.totalMinor) return null;
  const [row] = await tx
    .insert(folioCharges)
    .values({
      tenantId: r.tenantId,
      propertyId: r.propertyId,
      stayId: r.stayId,
      description: `${r.serviceName} (room ${r.roomCode})`,
      amountMinor: r.totalMinor,
      source: "order",
      requestId: r.id,
      createdByUserId: actorUserId,
    })
    .onConflictDoNothing()
    .returning({ id: folioCharges.id });
  return row ?? null;
}

async function stayOf(db: Db, ctx: TenantContext, propertyId: string, stayId: string) {
  const id = z.uuid().safeParse(stayId);
  if (!id.success) throw notFound("Stay not found.");
  const [row] = await db
    .select({
      id: stays.id,
      status: stays.status,
      checkInAt: stays.checkInAt,
      expectedCheckoutAt: stays.expectedCheckoutAt,
      checkedOutAt: stays.checkedOutAt,
      roomCode: rooms.roomCode,
      guestName: guests.name,
    })
    .from(stays)
    .innerJoin(rooms, eq(rooms.id, stays.roomId))
    .innerJoin(guests, and(eq(guests.id, stays.guestId), eq(guests.tenantId, stays.tenantId)))
    .where(and(eq(stays.id, id.data), eq(stays.tenantId, ctx.tenantId), eq(stays.propertyId, propertyId)));
  if (!row) throw notFound("Stay not found.");
  return row;
}

/** Balance due per stay = live charges − payments. */
export async function stayBalances(db: Db, tenantId: string, stayIds: string[]) {
  const out = new Map<string, number>();
  if (stayIds.length === 0) return out;
  const [charges, payments] = await Promise.all([
    db
      .select({ stayId: folioCharges.stayId, total: sql<number>`coalesce(sum(${folioCharges.amountMinor}), 0)::int` })
      .from(folioCharges)
      .where(and(eq(folioCharges.tenantId, tenantId), inArray(folioCharges.stayId, stayIds), isNull(folioCharges.voidedAt)))
      .groupBy(folioCharges.stayId),
    db
      .select({ stayId: folioPayments.stayId, total: sql<number>`coalesce(sum(${folioPayments.amountMinor}), 0)::int` })
      .from(folioPayments)
      .where(and(eq(folioPayments.tenantId, tenantId), inArray(folioPayments.stayId, stayIds)))
      .groupBy(folioPayments.stayId),
  ]);
  for (const c of charges) out.set(c.stayId, c.total);
  for (const p of payments) out.set(p.stayId, (out.get(p.stayId) ?? 0) - p.total);
  return out;
}

export async function getFolio(db: Db, ctx: TenantContext, propertyId: string, stayId: string) {
  const property = await requireProperty(db, ctx, propertyId, "folio.view");
  const stay = await stayOf(db, ctx, property.id, stayId);
  const [charges, payments] = await Promise.all([
    db
      .select({
        id: folioCharges.id,
        description: folioCharges.description,
        amountMinor: folioCharges.amountMinor,
        source: folioCharges.source,
        requestId: folioCharges.requestId,
        createdAt: folioCharges.createdAt,
        voidedAt: folioCharges.voidedAt,
        voidReason: folioCharges.voidReason,
      })
      .from(folioCharges)
      .where(and(eq(folioCharges.tenantId, ctx.tenantId), eq(folioCharges.stayId, stay.id)))
      .orderBy(asc(folioCharges.createdAt)),
    db
      .select()
      .from(folioPayments)
      .where(and(eq(folioPayments.tenantId, ctx.tenantId), eq(folioPayments.stayId, stay.id)))
      .orderBy(asc(folioPayments.createdAt)),
  ]);
  const charged = charges.filter((c) => !c.voidedAt).reduce((s, c) => s + c.amountMinor, 0);
  const paid = payments.reduce((s, p) => s + p.amountMinor, 0);
  // Room-charged orders not yet completed (will post on completion).
  const pending = await db
    .select({ id: serviceRequests.id, serviceName: serviceRequests.serviceName, totalMinor: serviceRequests.totalMinor, status: serviceRequests.status })
    .from(serviceRequests)
    .where(
      and(
        eq(serviceRequests.tenantId, ctx.tenantId),
        eq(serviceRequests.stayId, stay.id),
        eq(serviceRequests.paymentMethod, "room"),
        inArray(serviceRequests.status, ["new", "acknowledged", "in_progress", "reopened"]),
      ),
    );
  return { property, stay, charges, payments, charged, paid, balance: charged - paid, pending };
}

export const chargeSchema = (currency: string) =>
  z.object({
    description: nameSchema("Description", 120),
    amount: moneySchema(currency, { allowNegative: true }).refine((v) => v !== 0, "Amount can't be zero"),
  });

export async function addCharge(
  db: Db,
  ctx: TenantContext,
  propertyId: string,
  stayId: string,
  raw: { description: string; amount: string; externalRef?: string | null },
  actor: ChargeActor = { userId: ctx.userId, actorType: "user" },
) {
  const property = await requireProperty(db, ctx, propertyId, "folio.manage", { write: true });
  const stay = await stayOf(db, ctx, property.id, stayId);
  const input = chargeSchema(property.currency).parse(raw);
  const externalRef = optionalText(80).parse(raw.externalRef ?? undefined);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(folioCharges)
        .values({
          tenantId: ctx.tenantId,
          propertyId: property.id,
          stayId: stay.id,
          description: input.description,
          amountMinor: input.amount,
          source: actor.actorType === "api_key" ? "api" : "manual",
          externalRef,
          createdByUserId: actor.userId,
        })
        .returning();
      await writeAudit(tx, {
        tenantId: ctx.tenantId,
        actorUserId: actor.userId,
        actorType: actor.actorType,
        action: "folio.charge_added",
        entityType: "folio_charge",
        entityId: row.id,
        metadata: { propertyId: property.id, stayId: stay.id, amountMinor: row.amountMinor, ...(actor.apiKeyId ? { apiKeyId: actor.apiKeyId } : {}) },
      });
      return { charge: row, duplicate: false };
    });
  } catch (err) {
    if (externalRef && isUniqueViolation(err)) {
      const [existing] = await db
        .select()
        .from(folioCharges)
        .where(and(eq(folioCharges.tenantId, ctx.tenantId), eq(folioCharges.externalRef, externalRef)));
      if (existing) {
        if (existing.stayId !== stay.id) throw conflict("This external reference was already posted to another stay.");
        return { charge: existing, duplicate: true };
      }
    }
    throw err;
  }
}

export async function voidCharge(db: Db, ctx: TenantContext, propertyId: string, chargeId: string, raw: { reason?: string }) {
  const property = await requireProperty(db, ctx, propertyId, "folio.manage", { write: true });
  const reason = nameSchema("Reason", 200).parse(raw.reason ?? "");
  const id = z.uuid().safeParse(chargeId);
  if (!id.success) throw notFound("Charge not found.");
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(folioCharges)
      .where(and(eq(folioCharges.id, id.data), eq(folioCharges.tenantId, ctx.tenantId), eq(folioCharges.propertyId, property.id)))
      .for("update");
    if (!row) throw notFound("Charge not found.");
    if (row.voidedAt) throw conflict("This charge is already void.");
    await tx
      .update(folioCharges)
      .set({ voidedAt: new Date(), voidedByUserId: ctx.userId, voidReason: reason })
      .where(eq(folioCharges.id, row.id));
    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      actorType: "user",
      action: "folio.charge_voided",
      entityType: "folio_charge",
      entityId: row.id,
      metadata: { propertyId: property.id, stayId: row.stayId, amountMinor: row.amountMinor, reason },
    });
  });
}

export const paymentSchema = (currency: string) =>
  z.object({
    amount: moneySchema(currency).refine((v) => v > 0, "Amount must be more than zero"),
    method: z.enum(PAYMENT_METHODS, "Choose how the guest paid"),
    reference: optionalText(80),
  });

export async function recordPayment(
  db: Db,
  ctx: TenantContext,
  propertyId: string,
  stayId: string,
  raw: { amount: string; method: string; reference?: string },
) {
  const property = await requireProperty(db, ctx, propertyId, "folio.manage", { write: true });
  const stay = await stayOf(db, ctx, property.id, stayId);
  const input = paymentSchema(property.currency).parse(raw);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(folioPayments)
      .values({
        tenantId: ctx.tenantId,
        propertyId: property.id,
        stayId: stay.id,
        amountMinor: input.amount,
        method: input.method,
        reference: input.reference,
        createdByUserId: ctx.userId,
      })
      .returning();
    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      actorType: "user",
      action: "folio.payment_recorded",
      entityType: "folio_payment",
      entityId: row.id,
      metadata: { propertyId: property.id, stayId: stay.id, amountMinor: row.amountMinor, method: row.method },
    });
    return row;
  });
}

export const roomChargeSchema = z.object({
  roomCode: z.string().trim().min(1).max(20),
  description: nameSchema("Description", 120),
  amountMinor: z.number().int().refine((v) => v !== 0 && Math.abs(v) <= 100_000_000, "Amount must be a non-zero integer in minor units"),
  externalRef: z.string().trim().min(1, "externalRef is required for idempotent postings").max(80),
});

/**
 * POS / integration posting: charge the guest currently checked in to a room. Idempotent on
 * externalRef (a retry returns the original charge).
 */
export async function postChargeToRoom(db: Db, ctx: TenantContext, propertyId: string, raw: unknown, actor: ChargeActor) {
  const property = await requireProperty(db, ctx, propertyId, "folio.manage", { write: true });
  const input = roomChargeSchema.parse(raw);
  const [stay] = await db
    .select({ id: stays.id })
    .from(stays)
    .innerJoin(rooms, eq(rooms.id, stays.roomId))
    .where(
      and(
        eq(stays.tenantId, ctx.tenantId),
        eq(stays.propertyId, property.id),
        eq(stays.status, "checked_in"),
        sql`lower(${rooms.roomCode}) = lower(${input.roomCode})`,
        isNull(rooms.archivedAt),
      ),
    );
  if (!stay) throw conflict(`No guest is checked in to room ${input.roomCode}.`);
  const digits = minorDigits(property.currency);
  const major = (Math.abs(input.amountMinor) / 10 ** digits).toFixed(digits);
  return addCharge(
    db,
    ctx,
    property.id,
    stay.id,
    { description: input.description, amount: input.amountMinor < 0 ? `-${major}` : major, externalRef: input.externalRef },
    actor,
  );
}
