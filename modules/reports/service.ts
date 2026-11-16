import { aliasedTable, and, count, eq, gte, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/types";
import {
  departments,
  housekeepingTasks,
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
  return {
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
