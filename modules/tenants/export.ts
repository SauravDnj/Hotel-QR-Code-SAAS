import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/types";
import {
  auditLogs,
  departments,
  floors,
  guestPortalSettings,
  guests,
  housekeepingTasks,
  invoices,
  properties,
  roomCategories,
  rooms,
  serviceItems,
  serviceRequests,
  stays,
  tenantMemberships,
  tenants,
  userRoleAssignments,
  users,
  roles,
} from "@/lib/db/schema";
import { rateLimited } from "@/lib/errors";
import { authorize, type TenantContext } from "@/lib/permissions/authorize";
import { consumeRateLimit } from "@/lib/rate-limit";
import { writeAudit } from "@/modules/audit/service";

/**
 * Owner data export (SAAS_BILLING.md suspension policy; OPERATIONS_RUNBOOK.md "Export tenant
 * data"). Works for suspended tenants too. Contains the hotel's own business data, including
 * guest names/contacts it collected, but NO credentials or secrets: no password hashes, MFA
 * secrets, QR/status/invite token material, or Wi-Fi password. Rate-limited and audited.
 */
export async function exportTenantData(db: Db, ctx: TenantContext) {
  authorize(ctx, "tenant.manage");
  const rl = await consumeRateLimit(db, `export:${ctx.tenantId}`, { limit: 5, windowSeconds: 3600 });
  if (!rl.allowed) throw rateLimited();
  const t = ctx.tenantId;
  const [
    [tenant],
    props,
    floorRows,
    categoryRows,
    roomRows,
    deptRows,
    serviceRows,
    portalRows,
    staffRows,
    assignmentRows,
    guestRows,
    stayRows,
    requestRows,
    taskRows,
    invoiceRows,
    auditRows,
  ] = await Promise.all([
    db
      .select({ id: tenants.id, name: tenants.name, legalName: tenants.legalName, status: tenants.status, timezone: tenants.timezone, country: tenants.country, currency: tenants.currency, contactEmail: tenants.contactEmail, createdAt: tenants.createdAt })
      .from(tenants)
      .where(eq(tenants.id, t)),
    db.select().from(properties).where(eq(properties.tenantId, t)),
    db.select().from(floors).where(eq(floors.tenantId, t)),
    db.select().from(roomCategories).where(eq(roomCategories.tenantId, t)),
    db.select().from(rooms).where(eq(rooms.tenantId, t)),
    db.select().from(departments).where(eq(departments.tenantId, t)),
    db.select().from(serviceItems).where(eq(serviceItems.tenantId, t)),
    db
      .select({
        propertyId: guestPortalSettings.propertyId,
        enabled: guestPortalSettings.enabled,
        welcomeMessage: guestPortalSettings.welcomeMessage,
        wifiSsid: guestPortalSettings.wifiSsid,
        receptionPhone: guestPortalSettings.receptionPhone,
        contactEmail: guestPortalSettings.contactEmail,
        checkInTime: guestPortalSettings.checkInTime,
        checkOutTime: guestPortalSettings.checkOutTime,
        infoSections: guestPortalSettings.infoSections,
      })
      .from(guestPortalSettings)
      .where(eq(guestPortalSettings.tenantId, t)),
    db
      .select({ membershipId: tenantMemberships.id, name: users.name, email: users.email, status: tenantMemberships.status, joinedAt: tenantMemberships.createdAt })
      .from(tenantMemberships)
      .innerJoin(users, eq(users.id, tenantMemberships.userId))
      .where(eq(tenantMemberships.tenantId, t)),
    db
      .select({ membershipId: userRoleAssignments.membershipId, role: roles.name, propertyId: userRoleAssignments.propertyId, departmentId: userRoleAssignments.departmentId })
      .from(userRoleAssignments)
      .innerJoin(roles, eq(roles.id, userRoleAssignments.roleId))
      .where(eq(userRoleAssignments.tenantId, t)),
    db.select().from(guests).where(eq(guests.tenantId, t)),
    db.select().from(stays).where(eq(stays.tenantId, t)),
    db
      .select({
        id: serviceRequests.id,
        propertyId: serviceRequests.propertyId,
        roomCode: serviceRequests.roomCode,
        serviceName: serviceRequests.serviceName,
        departmentName: serviceRequests.departmentName,
        status: serviceRequests.status,
        priority: serviceRequests.priority,
        quantity: serviceRequests.quantity,
        option: serviceRequests.option,
        guestNote: serviceRequests.guestNote,
        guestMessage: serviceRequests.guestMessage,
        submittedAt: serviceRequests.submittedAt,
        acknowledgedAt: serviceRequests.acknowledgedAt,
        startedAt: serviceRequests.startedAt,
        completedAt: serviceRequests.completedAt,
        cancelledAt: serviceRequests.cancelledAt,
        cancelReason: serviceRequests.cancelReason,
      })
      .from(serviceRequests)
      .where(eq(serviceRequests.tenantId, t)),
    db.select().from(housekeepingTasks).where(eq(housekeepingTasks.tenantId, t)),
    db.select().from(invoices).where(eq(invoices.tenantId, t)),
    db
      .select({ action: auditLogs.action, entityType: auditLogs.entityType, entityId: auditLogs.entityId, actorType: auditLogs.actorType, metadata: auditLogs.metadata, createdAt: auditLogs.createdAt })
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, t)))
      .orderBy(desc(auditLogs.createdAt))
      .limit(5000),
  ]);
  await writeAudit(db, {
    tenantId: t,
    actorUserId: ctx.userId,
    actorType: "user",
    action: "tenant.data_exported",
    entityType: "tenant",
    entityId: t,
    metadata: { rooms: roomRows.length, requests: requestRows.length, stays: stayRows.length },
  });
  return {
    exportedAt: new Date().toISOString(),
    format: "hotel-saas-export/v1",
    tenant,
    properties: props,
    floors: floorRows,
    roomTypes: categoryRows,
    rooms: roomRows,
    departments: deptRows,
    services: serviceRows,
    guestPortal: portalRows,
    staff: staffRows,
    roleAssignments: assignmentRows,
    guests: guestRows,
    stays: stayRows,
    requests: requestRows,
    housekeepingTasks: taskRows,
    invoices: invoiceRows,
    auditLog: auditRows,
  };
}
