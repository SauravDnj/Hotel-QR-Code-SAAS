import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import { z } from "zod";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Db } from "@/lib/db/types";
import { departments, folioCharges, folioPayments, requestFeedback, serviceRequests } from "@/lib/db/schema";
import { toCsv, type CsvCell } from "@/lib/csv";
import { rateLimited } from "@/lib/errors";
import { minorDigits } from "@/lib/money";
import type { TenantContext } from "@/lib/permissions/authorize";
import { consumeRateLimit } from "@/lib/rate-limit";
import { writeAudit } from "@/modules/audit/service";
import { assertModule } from "@/modules/billing/subscription";
import { requireProperty } from "@/modules/properties/access";
import { requestScopeCondition } from "@/modules/requests/staff";
import { STAFF_STATUS_LABEL } from "@/modules/requests/state";
import { propertyReport, resolveRange } from "./service";

/**
 * Report downloads for accounts (CSV opens in Excel / Google Sheets). Same permission
 * (report.view), plan module, property, date range and department scope as the Reports page.
 * Guest-typed request notes are left out; amounts are in the property currency, major units.
 * Rate-limited and audited (what was exported, not the rows).
 */
export const EXPORT_TYPES = ["requests", "occupancy", "revenue"] as const;
export type ExportType = (typeof EXPORT_TYPES)[number];
export const MAX_EXPORT_ROWS = 20_000;

const typeSchema = z.enum(EXPORT_TYPES);

/** "YYYY-MM-DD HH:mm" in the property's timezone (sorts correctly as text). */
function localStamp(d: Date | null, timeZone: string): string {
  if (!d) return "";
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

const minutesBetween = (a: Date | null, b: Date | null) => (a && b ? Math.round(((b.getTime() - a.getTime()) / 60000) * 10) / 10 : null);

export async function exportReportCsv(
  db: Db,
  ctx: TenantContext,
  input: { type: unknown; propertyId: string; from?: string; to?: string },
  now: Date = new Date(),
): Promise<{ filename: string; csv: string; rows: number }> {
  const type = typeSchema.parse(input.type);
  const property = await requireProperty(db, ctx, input.propertyId, "report.view");
  await assertModule(db, ctx.tenantId, "reports");
  const rl = await consumeRateLimit(db, `report-export:${ctx.userId}`, { limit: 30, windowSeconds: 600 });
  if (!rl.allowed) throw rateLimited();
  const range = resolveRange({ from: input.from, to: input.to }, property.timezone, now);
  const currency = property.currency;
  const digits = minorDigits(currency);
  const money = (minor: number | null) => (minor === null ? null : Number((minor / 10 ** digits).toFixed(digits)));

  let header: string[];
  let rows: CsvCell[][];

  if (type === "requests") {
    const scope = requestScopeCondition(ctx, "request.view");
    const list = await db
      .select({
        r: {
          submittedAt: serviceRequests.submittedAt,
          roomCode: serviceRequests.roomCode,
          serviceName: serviceRequests.serviceName,
          departmentName: serviceRequests.departmentName,
          status: serviceRequests.status,
          priority: serviceRequests.priority,
          quantity: serviceRequests.quantity,
          option: serviceRequests.option,
          totalMinor: serviceRequests.totalMinor,
          paymentMethod: serviceRequests.paymentMethod,
          acknowledgedAt: serviceRequests.acknowledgedAt,
          completedAt: serviceRequests.completedAt,
          cancelledAt: serviceRequests.cancelledAt,
          escalatedAt: serviceRequests.escalatedAt,
          targetMinutes: serviceRequests.targetMinutes,
        },
        rating: requestFeedback.rating,
        comment: requestFeedback.comment,
      })
      .from(serviceRequests)
      .innerJoin(departments, eq(departments.id, serviceRequests.departmentId))
      .leftJoin(requestFeedback, eq(requestFeedback.requestId, serviceRequests.id))
      .where(
        and(
          eq(serviceRequests.tenantId, ctx.tenantId),
          eq(serviceRequests.propertyId, property.id),
          gte(serviceRequests.submittedAt, range.start),
          lt(serviceRequests.submittedAt, range.end),
          scope ?? sql`false`,
        ),
      )
      .orderBy(asc(serviceRequests.submittedAt))
      .limit(MAX_EXPORT_ROWS);
    header = [
      "Submitted",
      "Room",
      "Service",
      "Department",
      "Status",
      "Priority",
      "Quantity",
      "Choice",
      `Order total (${currency})`,
      "Payment",
      "Accepted",
      "Completed",
      "Cancelled",
      "Minutes to accept",
      "Minutes to complete",
      "Target minutes",
      "Escalated",
      "Guest rating",
      "Guest comment",
    ];
    rows = list.map(({ r, rating, comment }) => [
      localStamp(r.submittedAt, property.timezone),
      r.roomCode,
      r.serviceName,
      r.departmentName,
      STAFF_STATUS_LABEL[r.status],
      r.priority,
      r.quantity,
      r.option,
      money(r.totalMinor),
      r.paymentMethod === "room" ? "Room bill" : r.paymentMethod === "on_delivery" ? "On delivery" : "",
      localStamp(r.acknowledgedAt, property.timezone),
      localStamp(r.completedAt, property.timezone),
      localStamp(r.cancelledAt, property.timezone),
      minutesBetween(r.submittedAt, r.acknowledgedAt),
      minutesBetween(r.submittedAt, r.completedAt),
      r.targetMinutes,
      r.escalatedAt ? "Yes" : "No",
      rating,
      comment,
    ]);
  } else if (type === "occupancy") {
    const report = await propertyReport(db, ctx, property.id, { from: range.from, to: range.to }, now);
    header = ["Night of", "Occupied rooms", "Sellable rooms", "Occupancy %"];
    rows = report.occupancy.nights.map((n) => [
      n.date,
      n.occupied,
      n.occupied === null ? null : report.occupancy.sellable,
      n.rate === null ? null : Math.round(n.rate * 1000) / 10,
    ]);
  } else {
    // Revenue per local day (same money definitions as "Orders, bills and bookings").
    const tz = property.timezone;
    const day = (col: AnyPgColumn) => sql<string>`to_char((${col} at time zone ${tz})::date, 'YYYY-MM-DD')`;
    const orders = await db
      .select({
        day: day(serviceRequests.completedAt),
        delivered: sql<number>`count(*)`.mapWith(Number),
        totalMinor: sql<number>`coalesce(sum(${serviceRequests.totalMinor}), 0)`.mapWith(Number),
        roomMinor: sql<number>`coalesce(sum(${serviceRequests.totalMinor}) filter (where ${serviceRequests.paymentMethod} = 'room'), 0)`.mapWith(Number),
      })
      .from(serviceRequests)
      .where(
        and(
          eq(serviceRequests.tenantId, ctx.tenantId),
          eq(serviceRequests.propertyId, property.id),
          eq(serviceRequests.kind, "menu"),
          eq(serviceRequests.status, "completed"),
          gte(serviceRequests.completedAt, range.start),
          lt(serviceRequests.completedAt, range.end),
        ),
      )
      .groupBy(sql`1`);
    const charges = await db
      .select({ day: day(folioCharges.createdAt), minor: sql<number>`coalesce(sum(${folioCharges.amountMinor}), 0)`.mapWith(Number) })
      .from(folioCharges)
      .where(
        and(
          eq(folioCharges.tenantId, ctx.tenantId),
          eq(folioCharges.propertyId, property.id),
          sql`${folioCharges.voidedAt} is null`,
          gte(folioCharges.createdAt, range.start),
          lt(folioCharges.createdAt, range.end),
        ),
      )
      .groupBy(sql`1`);
    const payments = await db
      .select({ day: day(folioPayments.createdAt), minor: sql<number>`coalesce(sum(${folioPayments.amountMinor}), 0)`.mapWith(Number) })
      .from(folioPayments)
      .where(and(eq(folioPayments.tenantId, ctx.tenantId), eq(folioPayments.propertyId, property.id), gte(folioPayments.createdAt, range.start), lt(folioPayments.createdAt, range.end)))
      .groupBy(sql`1`);
    const o = new Map(orders.map((x) => [x.day, x]));
    const c = new Map(charges.map((x) => [x.day, x.minor]));
    const p = new Map(payments.map((x) => [x.day, x.minor]));
    header = ["Date", "Orders delivered", `Order value (${currency})`, `Orders charged to rooms (${currency})`, `Charged to guest bills (${currency})`, `Payments recorded (${currency})`];
    rows = range.dates.map((d) => [d, o.get(d)?.delivered ?? 0, money(o.get(d)?.totalMinor ?? 0), money(o.get(d)?.roomMinor ?? 0), money(c.get(d) ?? 0), money(p.get(d) ?? 0)]);
    const sum = (i: number) => Number(rows.reduce((a, r) => a + Number(r[i] ?? 0), 0).toFixed(digits));
    rows.push(["Total", rows.reduce((a, r) => a + Number(r[1] ?? 0), 0), sum(2), sum(3), sum(4), sum(5)]);
  }

  await writeAudit(db, {
    tenantId: ctx.tenantId,
    actorUserId: ctx.userId,
    actorType: "user",
    action: "report.exported",
    entityType: "property",
    entityId: property.id,
    metadata: { type, from: range.from, to: range.to, rows: rows.length },
  });
  const slug = property.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "property";
  return { filename: `${slug}-${type}-${range.from}-to-${range.to}.csv`, csv: toCsv(header, rows), rows: rows.length };
}
