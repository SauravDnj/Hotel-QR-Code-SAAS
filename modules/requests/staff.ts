import { aliasedTable, and, asc, desc, eq, inArray, isNull, max, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/types";
import {
  departments,
  folioCharges,
  properties,
  requestAssignments,
  requestItems,
  requestStatusHistory,
  serviceRequests,
  tenantMemberships,
  users,
} from "@/lib/db/schema";
import type { RequestStatus } from "@/lib/db/schema/enums";
import { conflict, forbidden, notFound } from "@/lib/errors";
import { assertTenantWritable, authorize, canWrite, type TenantContext } from "@/lib/permissions/authorize";
import type { PermissionKey } from "@/lib/permissions/catalog";
import { departmentScope, grantDepartments, inDepartmentScope, isEmptyScope } from "@/lib/permissions/departments";
import { optionalText } from "@/lib/validation/common";
import { writeAudit } from "@/modules/audit/service";
import { enqueueRequestEvent } from "@/modules/realtime/outbox";
import { postOrderCharge } from "@/modules/ordering/folio";
import { enqueueWebhookEvent } from "@/modules/integrations/webhooks";
import { loadTenantContext } from "@/modules/tenants/context";
import { ACTIONS, ACTIVE_STATUSES, canTransition, REASON_REQUIRED, type StaffAction } from "./state";

/**
 * Staff side of service requests. Visibility = request.view in the property AND a role
 * that covers the request's department (lib/permissions/departments.ts). Every action
 * re-checks permission + property + department scope on the server and validates the
 * transition against the state machine inside a row-locked transaction.
 */

/** SQL filter for requests the user may see/act on with `permission`. Needs a departments join. */
export function requestScopeCondition(ctx: TenantContext, permission: PermissionKey): SQL | null {
  const parts: SQL[] = [];
  for (const g of ctx.grants) {
    if (!g.permissions.has(permission)) continue;
    const conds: SQL[] = [];
    if (g.propertyId) conds.push(eq(serviceRequests.propertyId, g.propertyId));
    const depts = grantDepartments(g);
    if (depts !== "all") {
      const either: SQL[] = [];
      if (depts.keys.size) either.push(inArray(departments.key, [...depts.keys]));
      if (depts.ids.size) either.push(inArray(serviceRequests.departmentId, [...depts.ids]));
      if (either.length === 0) continue;
      conds.push(or(...either)!);
    }
    parts.push(conds.length ? and(...conds)! : sql`true`);
  }
  if (parts.length === 0) return null;
  return and(eq(serviceRequests.tenantId, ctx.tenantId), or(...parts))!;
}

export const inboxFilterSchema = z.object({
  view: z.enum(["active", "completed", "cancelled", "all"]).catch("active").default("active"),
  propertyId: z.uuid().optional().catch(undefined),
  mine: z.enum(["1"]).optional().catch(undefined),
});
export type InboxFilter = z.input<typeof inboxFilterSchema>;

const assignee = aliasedTable(users, "assignee");

export async function listInbox(db: Db, ctx: TenantContext, raw: InboxFilter = {}) {
  const f = inboxFilterSchema.parse(raw);
  const scope = requestScopeCondition(ctx, "request.view");
  if (!scope) return [];
  const statusCond =
    f.view === "active"
      ? inArray(serviceRequests.status, ACTIVE_STATUSES)
      : f.view === "all"
        ? undefined
        : eq(serviceRequests.status, f.view);
  return db
    .select({
      id: serviceRequests.id,
      propertyId: serviceRequests.propertyId,
      roomCode: serviceRequests.roomCode,
      serviceName: serviceRequests.serviceName,
      departmentName: serviceRequests.departmentName,
      departmentKey: departments.key,
      departmentId: serviceRequests.departmentId,
      status: serviceRequests.status,
      priority: serviceRequests.priority,
      quantity: serviceRequests.quantity,
      option: serviceRequests.option,
      kind: serviceRequests.kind,
      scheduledFor: serviceRequests.scheduledFor,
      timezone: properties.timezone,
      totalMinor: serviceRequests.totalMinor,
      currency: serviceRequests.currency,
      paymentMethod: serviceRequests.paymentMethod,
      guestNote: serviceRequests.guestNote,
      targetMinutes: serviceRequests.targetMinutes,
      escalatedAt: serviceRequests.escalatedAt,
      submittedAt: serviceRequests.submittedAt,
      updatedAt: serviceRequests.updatedAt,
      assignedUserId: serviceRequests.assignedUserId,
      assigneeName: assignee.name,
    })
    .from(serviceRequests)
    .innerJoin(departments, eq(departments.id, serviceRequests.departmentId))
    .innerJoin(properties, eq(properties.id, serviceRequests.propertyId))
    .leftJoin(assignee, eq(assignee.id, serviceRequests.assignedUserId))
    .where(
      and(
        scope,
        statusCond,
        f.propertyId ? eq(serviceRequests.propertyId, f.propertyId) : undefined,
        f.mine ? eq(serviceRequests.assignedUserId, ctx.userId) : undefined,
      ),
    )
    .orderBy(
      // Active view: new first, urgent first, oldest first. History views: newest first.
      ...(f.view === "active"
        ? [
            asc(sql`case ${serviceRequests.status} when 'new' then 0 when 'reopened' then 1 else 2 end`),
            asc(sql`case ${serviceRequests.priority} when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end`),
            asc(serviceRequests.submittedAt),
          ]
        : [desc(serviceRequests.submittedAt)]),
    )
    .limit(200);
}

/** Cheap change marker for polling clients and the sidebar badge. */
export async function inboxMarker(db: Db, ctx: TenantContext) {
  const scope = requestScopeCondition(ctx, "request.view");
  if (!scope) return { latest: null as string | null, newCount: 0, mineCount: 0, escalatedCount: 0 };
  const open = sql`${serviceRequests.status} in ('new', 'acknowledged', 'in_progress', 'reopened')`;
  const [row] = await db
    .select({
      latest: max(serviceRequests.updatedAt),
      newCount: sql<number>`count(*) filter (where ${serviceRequests.status} = 'new')`.mapWith(Number),
      mineCount: sql<number>`count(*) filter (where ${serviceRequests.assignedUserId} = ${ctx.userId} and ${open})`.mapWith(Number),
      escalatedCount: sql<number>`count(*) filter (where ${serviceRequests.status} = 'new' and ${serviceRequests.escalatedAt} is not null)`.mapWith(Number),
    })
    .from(serviceRequests)
    .innerJoin(departments, eq(departments.id, serviceRequests.departmentId))
    .where(scope);
  return {
    latest: row?.latest ? new Date(row.latest).toISOString() : null,
    newCount: row?.newCount ?? 0,
    mineCount: row?.mineCount ?? 0,
    escalatedCount: row?.escalatedCount ?? 0,
  };
}

async function loadScoped(db: Db, ctx: TenantContext, requestId: string, permission: PermissionKey, lock = false) {
  const id = z.uuid().safeParse(requestId);
  if (!id.success) throw notFound("Request not found.");
  // Look up within the tenant first so other tenants' ids are indistinguishable from missing ones.
  const q = db
    .select({ r: serviceRequests, departmentKey: departments.key })
    .from(serviceRequests)
    .innerJoin(departments, eq(departments.id, serviceRequests.departmentId))
    .where(and(eq(serviceRequests.id, id.data), eq(serviceRequests.tenantId, ctx.tenantId)));
  const [row] = lock ? await q.for("update", { of: serviceRequests }) : await q;
  if (!row) throw notFound("Request not found.");
  const viewScope = departmentScope(ctx, "request.view", row.r.propertyId);
  if (!inDepartmentScope(viewScope, { id: row.r.departmentId, key: row.departmentKey })) throw notFound("Request not found.");
  authorize(ctx, permission, { propertyId: row.r.propertyId });
  if (!inDepartmentScope(departmentScope(ctx, permission, row.r.propertyId), { id: row.r.departmentId, key: row.departmentKey })) throw forbidden();
  return row;
}

export async function getRequestForStaff(db: Db, ctx: TenantContext, requestId: string) {
  const { r, departmentKey } = await loadScoped(db, ctx, requestId, "request.view");
  const [history, [assigned], items] = await Promise.all([
    db
      .select({
        id: requestStatusHistory.id,
        fromStatus: requestStatusHistory.fromStatus,
        toStatus: requestStatusHistory.toStatus,
        source: requestStatusHistory.source,
        note: requestStatusHistory.note,
        changedAt: requestStatusHistory.changedAt,
        actorName: users.name,
      })
      .from(requestStatusHistory)
      .leftJoin(users, eq(users.id, requestStatusHistory.actorUserId))
      .where(and(eq(requestStatusHistory.tenantId, ctx.tenantId), eq(requestStatusHistory.requestId, r.id)))
      .orderBy(desc(requestStatusHistory.changedAt)),
    r.assignedUserId
      ? db.select({ name: users.name }).from(users).where(eq(users.id, r.assignedUserId))
      : Promise.resolve([] as { name: string }[]),
    db
      .select({ name: requestItems.name, quantity: requestItems.quantity, unitPriceMinor: requestItems.unitPriceMinor, lineTotalMinor: requestItems.lineTotalMinor })
      .from(requestItems)
      .where(and(eq(requestItems.tenantId, ctx.tenantId), eq(requestItems.requestId, r.id)))
      .orderBy(asc(requestItems.name)),
  ]);
  // Never expose guest token material to staff screens either.
  const { guestTokenHash: _h, guestTokenCiphertext: _c, idempotencyKey: _k, ...safe } = r;
  void _h;
  void _c;
  void _k;
  return { request: { ...safe, departmentKey, assigneeName: assigned?.name ?? null }, history, items };
}

export const transitionSchema = z.object({
  note: optionalText(500),
  guestMessage: optionalText(300),
});
export type TransitionInput = z.input<typeof transitionSchema>;

const TIMESTAMP: Partial<Record<RequestStatus, keyof typeof serviceRequests.$inferInsert>> = {
  acknowledged: "acknowledgedAt",
  in_progress: "startedAt",
  completed: "completedAt",
  cancelled: "cancelledAt",
};

export async function transitionRequest(
  db: Db,
  ctx: TenantContext,
  requestId: string,
  action: StaffAction,
  raw: TransitionInput = {},
) {
  const spec = ACTIONS[action];
  if (!spec) throw notFound();
  assertTenantWritable(ctx);
  const input = transitionSchema.parse(raw);
  if (REASON_REQUIRED.has(action) && !input.note) {
    throw new z.ZodError([{ code: "custom", path: ["note"], message: "Please give a reason", input: "" }]);
  }
  return db.transaction(async (tx) => {
    const { r } = await loadScoped(tx, ctx, requestId, spec.permission, true);
    if (!canTransition(r.status, action)) {
      throw conflict(`This request is already ${r.status.replace("_", " ")}. Refresh to see the latest.`);
    }
    const now = new Date();
    const patch: Partial<typeof serviceRequests.$inferInsert> = { status: spec.to };
    const ts = TIMESTAMP[spec.to];
    if (ts) (patch as Record<string, unknown>)[ts] = now;
    if (action === "cancel") patch.cancelReason = input.note;
    if (action === "reopen") {
      patch.completedAt = null;
    }
    if (input.guestMessage) patch.guestMessage = input.guestMessage;
    // Accepting an unassigned request makes the accepter its owner.
    if (action === "acknowledge" && !r.assignedUserId) {
      patch.assignedUserId = ctx.userId;
      await tx.insert(requestAssignments).values({ tenantId: ctx.tenantId, requestId: r.id, userId: ctx.userId, assignedByUserId: ctx.userId });
    }
    await tx.update(serviceRequests).set(patch).where(and(eq(serviceRequests.id, r.id), eq(serviceRequests.tenantId, ctx.tenantId)));
    await tx.insert(requestStatusHistory).values({
      tenantId: ctx.tenantId,
      requestId: r.id,
      fromStatus: r.status,
      toStatus: spec.to,
      actorUserId: ctx.userId,
      source: "staff",
      note: input.note,
    });
    await enqueueRequestEvent(tx, {
      tenantId: ctx.tenantId,
      propertyId: r.propertyId,
      departmentId: r.departmentId,
      requestId: r.id,
      type: "service_request.updated",
    });
    // Phase 9: a room-charged order posts to the guest bill once, when delivered; a cancelled
    // order's charge (if it was completed and reopened) is voided.
    if (spec.to === "completed") {
      await postOrderCharge(tx, r, ctx.userId);
      await enqueueWebhookEvent(tx, ctx.tenantId, "request.completed", {
        requestId: r.id,
        propertyId: r.propertyId,
        roomCode: r.roomCode,
        service: r.serviceName,
        totalMinor: r.totalMinor,
        currency: r.currency,
        paymentMethod: r.paymentMethod,
      });
    }
    if (action === "cancel") {
      await tx
        .update(folioCharges)
        .set({ voidedAt: now, voidedByUserId: ctx.userId, voidReason: "Order cancelled" })
        .where(and(eq(folioCharges.tenantId, ctx.tenantId), eq(folioCharges.requestId, r.id), isNull(folioCharges.voidedAt)));
    }
    if (action === "cancel" || action === "reopen") {
      await writeAudit(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        actorType: "user",
        action: `request.${action === "cancel" ? "cancelled" : "reopened"}`,
        entityType: "service_request",
        entityId: r.id,
        metadata: { propertyId: r.propertyId, roomCode: r.roomCode, service: r.serviceName, reason: input.note },
      });
    }
    return { from: r.status, to: spec.to };
  });
}

/** Staff who could handle this request (active members whose role covers its department). */
export async function listAssignableStaff(db: Db, ctx: TenantContext, requestId: string) {
  const { r, departmentKey } = await loadScoped(db, ctx, requestId, "request.assign");
  const members = await db
    .select({ userId: users.id, name: users.name })
    .from(tenantMemberships)
    .innerJoin(users, eq(users.id, tenantMemberships.userId))
    .where(and(eq(tenantMemberships.tenantId, ctx.tenantId), eq(tenantMemberships.status, "active"), eq(users.status, "active")))
    .orderBy(asc(users.name))
    .limit(200);
  const out: { userId: string; name: string }[] = [];
  for (const m of members) {
    const mctx = await loadTenantContext(db, m.userId, ctx.tenantId);
    if (!mctx) continue;
    const s = departmentScope(mctx, "request.update", r.propertyId);
    if (isEmptyScope(s)) continue;
    if (inDepartmentScope(s, { id: r.departmentId, key: departmentKey })) out.push(m);
  }
  return out;
}

export async function assignRequest(db: Db, ctx: TenantContext, requestId: string, userId: string) {
  assertTenantWritable(ctx);
  const target = z.uuid("Choose a staff member").parse(userId);
  const eligible = await listAssignableStaff(db, ctx, requestId);
  const person = eligible.find((e) => e.userId === target);
  if (!person) throw new z.ZodError([{ code: "custom", path: ["userId"], message: "This person cannot handle this request", input: target }]);
  return db.transaction(async (tx) => {
    const { r } = await loadScoped(tx, ctx, requestId, "request.assign", true);
    if (r.status === "completed" || r.status === "cancelled") throw conflict("Closed requests cannot be reassigned.");
    if (r.assignedUserId === target) return;
    await tx
      .update(requestAssignments)
      .set({ endedAt: new Date() })
      .where(and(eq(requestAssignments.tenantId, ctx.tenantId), eq(requestAssignments.requestId, r.id), isNull(requestAssignments.endedAt)));
    await tx.insert(requestAssignments).values({ tenantId: ctx.tenantId, requestId: r.id, userId: target, assignedByUserId: ctx.userId });
    await tx.update(serviceRequests).set({ assignedUserId: target }).where(eq(serviceRequests.id, r.id));
    await tx.insert(requestStatusHistory).values({
      tenantId: ctx.tenantId,
      requestId: r.id,
      fromStatus: r.status,
      toStatus: r.status,
      actorUserId: ctx.userId,
      source: "staff",
      note: `Assigned to ${person.name}`,
    });
    await enqueueRequestEvent(tx, {
      tenantId: ctx.tenantId,
      propertyId: r.propertyId,
      departmentId: r.departmentId,
      requestId: r.id,
      type: "service_request.updated",
    });
  });
}

/** UI helper: actions this user may take on a request (the server re-checks on submit). */
export function allowedActions(
  ctx: TenantContext,
  r: { status: RequestStatus; propertyId: string; departmentId: string; departmentKey: string },
): StaffAction[] {
  return (Object.keys(ACTIONS) as StaffAction[]).filter((a) => {
    const spec = ACTIONS[a];
    if (!canTransition(r.status, a)) return false;
    if (!canWrite(ctx, spec.permission, { propertyId: r.propertyId })) return false;
    return inDepartmentScope(departmentScope(ctx, spec.permission, r.propertyId), { id: r.departmentId, key: r.departmentKey });
  });
}

/** Realtime channels this user may subscribe to (concrete names; never from the browser). */
export async function subscribableChannels(db: Db, ctx: TenantContext) {
  const rows = await db
    .select({ id: departments.id, key: departments.key, propertyId: departments.propertyId })
    .from(departments)
    .where(eq(departments.tenantId, ctx.tenantId));
  return rows.filter((d) => {
    try {
      authorize(ctx, "request.view", { propertyId: d.propertyId });
    } catch {
      return false;
    }
    return inDepartmentScope(departmentScope(ctx, "request.view", d.propertyId), d);
  });
}

