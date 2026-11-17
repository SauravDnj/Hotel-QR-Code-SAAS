import { aliasedTable, and, count, eq, gte, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/types";
import {
  departments,
  folioCharges,
  folioPayments,
  housekeepingTasks,
  reservations,
  requestStatusHistory,
  rooms,
  serviceRequests,
  stays,
  users,
} from "@/lib/db/schema";
import { propertyScope, type TenantContext } from "@/lib/permissions/authorize";
import { localDate, zonedToUtc } from "@/lib/timezones";
import { assertModule } from "@/modules/billing/subscription";
import { readinessBoard } from "@/modules/housekeeping/service";
import { requireProperty } from "@/modules/properties/access";
import { listProperties } from "@/modules/properties/service";
import { ACTIVE_STATUSES } from "@/modules/requests/state";
import { requestScopeCondition } from "@/modules/requests/staff";

/**
 * Hotel metrics (ANALYTICS_REPORTING.md). Definitions, also shown on the Reports page:
 * - Sellable rooms: live (not archived) rooms whose operational status is "In service",
 *   measured now (rooms taken out of service for part of the range are not pro-rated).
 * - Occupied room-night for local date D: a stay was in progress at the local midnight that
 *   ends D (check-in before it, and checkout after it or still in house).
 * - Occupancy rate = occupied room-nights / sellable rooms, per night; the range figure is
 *   the sum of occupied room-nights / (sellable rooms × nights), future nights excluded.
 * - Acknowledgement time = acknowledged_at − submitted_at; completion time = completed_at −
 *   submitted_at. Each request is counted once (reopened requests use their final times).
 * - Requests "in range" = submitted within the range (property local dates, inclusive).
 * - Cleaning time = task completed_at − started_at; inspection pass rate = passed / done.
 * All queries are restricted to the tenant and the caller's property (and department) scope.
 */

export const MAX_RANGE_DAYS = 92;

export const rangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
});

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function resolveRange(raw: z.input<typeof rangeSchema>, timeZone: string, now: Date = new Date()) {
  const r = rangeSchema.parse(raw);
  const today = localDate(now, timeZone);
  let to = r.to ?? today;
  let from = r.from ?? addDays(to, -6);
  if (from > to) [from, to] = [to, from];
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400_000) + 1;
  if (days > MAX_RANGE_DAYS) from = addDays(to, -(MAX_RANGE_DAYS - 1));
  const dates: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
  return {
    from,
    to,
    dates,
    start: zonedToUtc(from, "00:00", timeZone),
    end: zonedToUtc(addDays(to, 1), "00:00", timeZone),
  };
}

const minutes = (col: SQL) => sql<number | null>`round((${col})::numeric / 60, 1)`.mapWith((v) => (v === null ? null : Number(v)));

export async function propertyReport(db: Db, ctx: TenantContext, propertyId: string, raw: z.input<typeof rangeSchema>, now: Date = new Date()) {
  const property = await requireProperty(db, ctx, propertyId, "report.view");
  await assertModule(db, ctx.tenantId, "reports");
  const range = resolveRange(raw, property.timezone, now);

  // ---- occupancy
  const [{ sellable }] = await db
    .select({ sellable: count() })
    .from(rooms)
    .where(and(eq(rooms.tenantId, ctx.tenantId), eq(rooms.propertyId, property.id), isNull(rooms.archivedAt), eq(rooms.operationalStatus, "active")));
  const stayRows = await db
    .select({ roomId: stays.roomId, checkInAt: stays.checkInAt, checkedOutAt: stays.checkedOutAt })
    .from(stays)
    .where(
      and(
        eq(stays.tenantId, ctx.tenantId),
        eq(stays.propertyId, property.id),
        lt(stays.checkInAt, range.end),
        or(isNull(stays.checkedOutAt), gte(stays.checkedOutAt, range.start)),
      ),
    );
  const nights = range.dates.map((date) => {
    const boundary = zonedToUtc(addDays(date, 1), "00:00", property.timezone);
    if (boundary > now) return { date, occupied: null as number | null, rate: null as number | null };
    const occupied = new Set(
      stayRows.filter((s) => s.checkInAt < boundary && (s.checkedOutAt === null || s.checkedOutAt > boundary)).map((s) => s.roomId),
    ).size;
    return { date, occupied, rate: sellable ? occupied / sellable : null };
  });
  const past = nights.filter((n) => n.occupied !== null);
  const roomNights = past.reduce((a, n) => a + (n.occupied ?? 0), 0);
  const checkIns = stayRows.filter((s) => s.checkInAt >= range.start && s.checkInAt < range.end).length;
  const checkOuts = stayRows.filter((s) => s.checkedOutAt && s.checkedOutAt >= range.start && s.checkedOutAt < range.end).length;

  // ---- requests (also limited to the caller's department scope)
  const scope = requestScopeCondition(ctx, "request.view");
  const inRange = and(
    eq(serviceRequests.tenantId, ctx.tenantId),
    eq(serviceRequests.propertyId, property.id),
    gte(serviceRequests.submittedAt, range.start),
    lt(serviceRequests.submittedAt, range.end),
    scope ?? sql`false`,
  );
  const ack = sql`extract(epoch from (${serviceRequests.acknowledgedAt} - ${serviceRequests.submittedAt}))`;
  const done = sql`extract(epoch from (${serviceRequests.completedAt} - ${serviceRequests.submittedAt}))`;
  const [totals] = await db
    .select({
      total: count(),
      completed: sql<number>`count(*) filter (where ${serviceRequests.status} = 'completed')`.mapWith(Number),
      cancelled: sql<number>`count(*) filter (where ${serviceRequests.status} = 'cancelled')`.mapWith(Number),
      open: sql<number>`count(*) filter (where ${inArray(serviceRequests.status, ACTIVE_STATUSES)})`.mapWith(Number),
      escalated: sql<number>`count(*) filter (where ${serviceRequests.escalatedAt} is not null)`.mapWith(Number),
      ackAvg: minutes(sql`avg(${ack})`),
      ackP50: minutes(sql`percentile_cont(0.5) within group (order by ${ack})`),
      ackP90: minutes(sql`percentile_cont(0.9) within group (order by ${ack})`),
      doneAvg: minutes(sql`avg(${done})`),
      doneP50: minutes(sql`percentile_cont(0.5) within group (order by ${done})`),
      doneP90: minutes(sql`percentile_cont(0.9) within group (order by ${done})`),
    })
    .from(serviceRequests)
    .innerJoin(departments, eq(departments.id, serviceRequests.departmentId))
    .where(inRange);
  const byDepartment = await db
    .select({
      department: serviceRequests.departmentName,
      total: count(),
      completed: sql<number>`count(*) filter (where ${serviceRequests.status} = 'completed')`.mapWith(Number),
      cancelled: sql<number>`count(*) filter (where ${serviceRequests.status} = 'cancelled')`.mapWith(Number),
      // Missed target: accepted after the target time, or still not accepted past it.
      lateAck: sql<number>`count(*) filter (where (${serviceRequests.acknowledgedAt} > ${serviceRequests.submittedAt} + make_interval(mins => ${serviceRequests.targetMinutes})) or (${serviceRequests.acknowledgedAt} is null and ${serviceRequests.status} <> 'cancelled' and now() > ${serviceRequests.submittedAt} + make_interval(mins => ${serviceRequests.targetMinutes})))`.mapWith(Number),
      ackAvg: minutes(sql`avg(${ack})`),
      doneAvg: minutes(sql`avg(${done})`),
    })
    .from(serviceRequests)
    .innerJoin(departments, eq(departments.id, serviceRequests.departmentId))
    .where(inRange)
    .groupBy(serviceRequests.departmentName)
    .orderBy(sql`count(*) desc`);
  const byService = await db
    .select({ service: serviceRequests.serviceName, total: count() })
    .from(serviceRequests)
    .innerJoin(departments, eq(departments.id, serviceRequests.departmentId))
    .where(inRange)
    .groupBy(serviceRequests.serviceName)
    .orderBy(sql`count(*) desc`)
    .limit(20);
  const [reopened] = await db
    .select({ n: sql<number>`count(distinct ${requestStatusHistory.requestId})`.mapWith(Number) })
    .from(requestStatusHistory)
    .innerJoin(serviceRequests, eq(serviceRequests.id, requestStatusHistory.requestId))
    .innerJoin(departments, eq(departments.id, serviceRequests.departmentId))
    .where(and(inRange, eq(requestStatusHistory.toStatus, "reopened")));

  // ---- staff workload: who completed requests in range
  const actor = aliasedTable(users, "actor");
  const staffCompletions = await db
    .select({ name: actor.name, completed: count() })
    .from(requestStatusHistory)
    .innerJoin(actor, eq(actor.id, requestStatusHistory.actorUserId))
    .innerJoin(serviceRequests, eq(serviceRequests.id, requestStatusHistory.requestId))
    .innerJoin(departments, eq(departments.id, serviceRequests.departmentId))
    .where(
      and(
        eq(requestStatusHistory.tenantId, ctx.tenantId),
        eq(serviceRequests.propertyId, property.id),
        eq(requestStatusHistory.toStatus, "completed"),
        gte(requestStatusHistory.changedAt, range.start),
        lt(requestStatusHistory.changedAt, range.end),
        scope ?? sql`false`,
      ),
    )
    .groupBy(actor.name)
    .orderBy(sql`count(*) desc`)
    .limit(20);

  // ---- housekeeping
  const hkRange = and(
    eq(housekeepingTasks.tenantId, ctx.tenantId),
    eq(housekeepingTasks.propertyId, property.id),
    eq(housekeepingTasks.status, "done"),
    gte(housekeepingTasks.completedAt, range.start),
    lt(housekeepingTasks.completedAt, range.end),
  );
  const [hk] = await db
    .select({
      cleanings: sql<number>`count(*) filter (where ${housekeepingTasks.taskType} = 'cleaning')`.mapWith(Number),
      cleanAvg: minutes(sql`avg(extract(epoch from (${housekeepingTasks.completedAt} - ${housekeepingTasks.startedAt}))) filter (where ${housekeepingTasks.taskType} = 'cleaning' and ${housekeepingTasks.startedAt} is not null)`),
      inspPassed: sql<number>`count(*) filter (where ${housekeepingTasks.taskType} = 'inspection' and ${housekeepingTasks.outcome} = 'passed')`.mapWith(Number),
      inspFailed: sql<number>`count(*) filter (where ${housekeepingTasks.taskType} = 'inspection' and ${housekeepingTasks.outcome} = 'failed')`.mapWith(Number),
    })
    .from(housekeepingTasks)
    .where(hkRange);
  const cleaner = aliasedTable(users, "cleaner");
  const cleanersByStaff = await db
    .select({ name: cleaner.name, cleanings: count() })
    .from(housekeepingTasks)
    .innerJoin(cleaner, eq(cleaner.id, housekeepingTasks.completedByUserId))
    .where(and(hkRange, eq(housekeepingTasks.taskType, "cleaning")))
    .groupBy(cleaner.name)
    .orderBy(sql`count(*) desc`)
    .limit(20);

  const inspections = (hk?.inspPassed ?? 0) + (hk?.inspFailed ?? 0);
  const commercial = await commercialMetrics(db, ctx.tenantId, property.id, range);
  return {
    commercial,
    property,
    range: { from: range.from, to: range.to, days: range.dates.length },
    occupancy: {
      sellable,
      nights,
      roomNights,
      rate: past.length && sellable ? roomNights / (sellable * past.length) : null,
      checkIns,
      checkOuts,
    },
    requests: {
      ...totals,
      reopened: reopened?.n ?? 0,
      cancelledRate: totals && totals.total ? totals.cancelled / totals.total : null,
      byDepartment,
      byService,
    },
    housekeeping: {
      cleanings: hk?.cleanings ?? 0,
      cleanAvg: hk?.cleanAvg ?? null,
      inspectionsPassed: hk?.inspPassed ?? 0,
      inspectionsFailed: hk?.inspFailed ?? 0,
      passRate: inspections ? (hk?.inspPassed ?? 0) / inspections : null,
    },
    staff: { completions: staffCompletions, cleanings: cleanersByStaff },
  };
}

/** Live "today" figures for the dashboard across every property the user can see. */
export async function dashboardMetrics(db: Db, ctx: TenantContext, now: Date = new Date()) {
  const scope = propertyScope(ctx, "room.view");
  if (scope !== "all" && scope.length === 0) return null;
  const props = await listProperties(db, ctx);
  const rooms = { total: 0, occupied: 0, ready: 0, needsWork: 0, outOfService: 0 };
  let departuresToday = 0;
  for (const p of props) {
    const board = await readinessBoard(db, ctx, p.id).catch(() => null);
    if (!board) continue;
    rooms.total += board.items.length;
    rooms.occupied += board.counts.occupied ?? 0;
    rooms.ready += board.counts.ready ?? 0;
    rooms.needsWork += (board.counts.needs_cleaning ?? 0) + (board.counts.cleaning ?? 0) + (board.counts.awaiting_inspection ?? 0);
    rooms.outOfService += board.counts.out_of_service ?? 0;
    const today = localDate(now, p.timezone);
    departuresToday += board.items.filter((i) => i.expectedCheckoutAt && localDate(i.expectedCheckoutAt, p.timezone) <= today).length;
  }
  const reqScope = requestScopeCondition(ctx, "request.view");
  let requests = null as null | { new: number; inProgress: number; overdue: number; escalated: number };
  if (reqScope) {
    const [r] = await db
      .select({
        new: sql<number>`count(*) filter (where ${serviceRequests.status} = 'new')`.mapWith(Number),
        inProgress: sql<number>`count(*) filter (where ${serviceRequests.status} in ('acknowledged', 'in_progress', 'reopened'))`.mapWith(Number),
        overdue: sql<number>`count(*) filter (where now() > ${serviceRequests.submittedAt} + make_interval(mins => ${serviceRequests.targetMinutes}))`.mapWith(Number),
        escalated: sql<number>`count(*) filter (where ${serviceRequests.escalatedAt} is not null and ${serviceRequests.status} = 'new')`.mapWith(Number),
      })
      .from(serviceRequests)
      .innerJoin(departments, eq(departments.id, serviceRequests.departmentId))
      .where(and(reqScope, inArray(serviceRequests.status, ACTIVE_STATUSES)));
    requests = r ?? { new: 0, inProgress: 0, overdue: 0, escalated: 0 };
  }
  return { rooms, departuresToday, requests };
}

/**
 * Phase 9 commercial figures for a property and range (ANALYTICS_REPORTING.md "Revenue reports
 * only where billing/POS data is integrated"): guest orders delivered, guest-bill charges and
 * payments recorded here, and booking activity. Amounts are minor units of the property currency.
 */
export async function commercialMetrics(db: Db, tenantId: string, propertyId: string, range: { from: string; to: string; start: Date; end: Date }) {
  const [orders] = await db
    .select({
      delivered: count(),
      totalMinor: sql<number>`coalesce(sum(${serviceRequests.totalMinor}), 0)`.mapWith(Number),
      roomChargedMinor: sql<number>`coalesce(sum(${serviceRequests.totalMinor}) filter (where ${serviceRequests.paymentMethod} = 'room'), 0)`.mapWith(Number),
    })
    .from(serviceRequests)
    .where(
      and(
        eq(serviceRequests.tenantId, tenantId),
        eq(serviceRequests.propertyId, propertyId),
        eq(serviceRequests.kind, "menu"),
        eq(serviceRequests.status, "completed"),
        gte(serviceRequests.completedAt, range.start),
        lt(serviceRequests.completedAt, range.end),
      ),
    );
  const [charges] = await db
    .select({ totalMinor: sql<number>`coalesce(sum(${folioCharges.amountMinor}), 0)`.mapWith(Number) })
    .from(folioCharges)
    .where(
      and(
        eq(folioCharges.tenantId, tenantId),
        eq(folioCharges.propertyId, propertyId),
        isNull(folioCharges.voidedAt),
        gte(folioCharges.createdAt, range.start),
        lt(folioCharges.createdAt, range.end),
      ),
    );
  const [payments] = await db
    .select({ totalMinor: sql<number>`coalesce(sum(${folioPayments.amountMinor}), 0)`.mapWith(Number) })
    .from(folioPayments)
    .where(and(eq(folioPayments.tenantId, tenantId), eq(folioPayments.propertyId, propertyId), gte(folioPayments.createdAt, range.start), lt(folioPayments.createdAt, range.end)));
  const [bookings] = await db
    .select({
      created: sql<number>`count(*) filter (where ${reservations.createdAt} >= ${range.start.toISOString()}::timestamptz and ${reservations.createdAt} < ${range.end.toISOString()}::timestamptz)`.mapWith(Number),
      arrivals: sql<number>`count(*) filter (where ${reservations.arrivalDate} between ${range.from}::date and ${range.to}::date and ${reservations.status} in ('confirmed', 'checked_in', 'completed'))`.mapWith(Number),
      cancelled: sql<number>`count(*) filter (where ${reservations.status} = 'cancelled' and ${reservations.cancelledAt} >= ${range.start.toISOString()}::timestamptz and ${reservations.cancelledAt} < ${range.end.toISOString()}::timestamptz)`.mapWith(Number),
      noShows: sql<number>`count(*) filter (where ${reservations.status} = 'no_show' and ${reservations.arrivalDate} between ${range.from}::date and ${range.to}::date)`.mapWith(Number),
    })
    .from(reservations)
    .where(and(eq(reservations.tenantId, tenantId), eq(reservations.propertyId, propertyId)));
  return {
    orders: { delivered: orders?.delivered ?? 0, totalMinor: orders?.totalMinor ?? 0, roomChargedMinor: orders?.roomChargedMinor ?? 0 },
    folio: { chargedMinor: charges?.totalMinor ?? 0, paidMinor: payments?.totalMinor ?? 0 },
    bookings: bookings ?? { created: 0, arrivals: 0, cancelled: 0, noShows: 0 },
  };
}

/**
 * Multi-property comparison (Phase 9): one row per property the caller may report on, same
 * definitions as the property report. Ranges are resolved in each property's own timezone.
 */
export async function portfolioReport(db: Db, ctx: TenantContext, raw: z.input<typeof rangeSchema>, now: Date = new Date()) {
  await assertModule(db, ctx.tenantId, "reports");
  const scope = propertyScope(ctx, "report.view");
  const props = (await listProperties(db, ctx)).filter((p) => scope === "all" || scope.includes(p.id));
  const rows = [];
  for (const p of props) {
    const r = await propertyReport(db, ctx, p.id, raw, now);
    rows.push({
      propertyId: p.id,
      name: p.name,
      currency: p.currency,
      range: r.range,
      sellable: r.occupancy.sellable,
      occupancy: r.occupancy.rate,
      roomNights: r.occupancy.roomNights,
      checkIns: r.occupancy.checkIns,
      requests: r.requests.total ?? 0,
      ackP50: r.requests.ackP50 ?? null,
      doneP50: r.requests.doneP50 ?? null,
      escalated: r.requests.escalated ?? 0,
      onTimeRate:
        r.requests.total && r.requests.byDepartment.length
          ? 1 - r.requests.byDepartment.reduce((a, d) => a + d.lateAck, 0) / Math.max(1, r.requests.total - (r.requests.cancelled ?? 0))
          : null,
      inspectionPassRate: r.housekeeping.passRate,
      ordersMinor: r.commercial.orders.totalMinor,
      chargedMinor: r.commercial.folio.chargedMinor,
      paidMinor: r.commercial.folio.paidMinor,
      bookings: r.commercial.bookings.created,
      arrivals: r.commercial.bookings.arrivals,
      noShows: r.commercial.bookings.noShows,
    });
  }
  const sellable = rows.reduce((a, r) => a + r.sellable, 0);
  const nights = rows[0]?.range.days ?? 0;
  return {
    rows,
    totals: {
      properties: rows.length,
      sellable,
      roomNights: rows.reduce((a, r) => a + r.roomNights, 0),
      requests: rows.reduce((a, r) => a + r.requests, 0),
      escalated: rows.reduce((a, r) => a + r.escalated, 0),
      // Revenue is only summed across properties that share one currency.
      currency: new Set(rows.map((r) => r.currency)).size === 1 ? (rows[0]?.currency ?? null) : null,
      ordersMinor: rows.reduce((a, r) => a + r.ordersMinor, 0),
      nights,
    },
  };
}
