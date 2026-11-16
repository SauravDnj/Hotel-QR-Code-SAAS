import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/lib/db/types";
import { rateLimits, roles } from "@/lib/db/schema";
import { can, type TenantContext } from "@/lib/permissions/authorize";
import { ALL_PERMISSION_KEYS, SYSTEM_ROLES, type SystemRoleKey } from "@/lib/permissions/catalog";
import { listTenantAuditLogs } from "@/modules/audit/service";
import { updatePortalSettings } from "@/modules/guest-portal/settings";
import { createProperty } from "@/modules/properties/service";
import { getRoomQr, rotateRoomQr } from "@/modules/qr/service";
import { submitGuestRequest } from "@/modules/requests/guest";
import { listInbox, transitionRequest } from "@/modules/requests/staff";
import { createCategory } from "@/modules/rooms/categories";
import { createFloor } from "@/modules/rooms/floors";
import { changeRoomStatus, createRoom, listRooms } from "@/modules/rooms/rooms";
import { createDefaultServices, createService, listServices } from "@/modules/services/catalog";
import { createRole } from "@/modules/staff/roles";
import { createInvitation, listStaff } from "@/modules/staff/service";
import { updateTenantSettings } from "@/modules/tenants/settings";
import { startCleaning } from "@/modules/housekeeping/service";
import { checkIn, listInHouse } from "@/modules/stays/service";
import { addStaff, createTenantFixture, createTestDb, type TenantFixture } from "../helpers/db";

/**
 * Phase 5 exit criterion: "role/scope test matrix passes". Every system role is run against
 * representative operations through the real service layer (not the UI), for:
 *  1. tenant-wide assignment → expected allow/deny per RBAC_PERMISSIONS.md;
 *  2. the same role scoped to ANOTHER property → always denied here.
 */

const ROLES = Object.keys(SYSTEM_ROLES) as SystemRoleKey[];

type Op = { name: string; allowed: SystemRoleKey[]; run: (ctx: TenantContext) => Promise<unknown> };

describe("role / scope permission matrix", () => {
  let db: Db;
  let T: TenantFixture;
  let otherPropertyId: string;
  let roomId: string;
  let qr: string;
  let svc: Record<string, { id: string; departmentId: string }>;
  let n = 0;
  let floorId: string;
  let catId: string;
  const freshRoom = async () => (await createRoom(db, T.ctx, T.propertyId, { roomCode: `M${++n}`, floorId, categoryId: catId })).id;

  const request = async (key: string, extra: Record<string, string> = {}) => {
    const r = await submitGuestRequest(db, qr, { serviceId: svc[key].id, idempotencyKey: crypto.randomUUID(), ...extra }, { ip: null });
    if (r.kind !== "ok") throw new Error(`setup: ${JSON.stringify(r)}`);
    return r.requestId;
  };

  const OPS: Op[] = [
    { name: "view rooms", allowed: ROLES, run: (c) => listRooms(db, c, T.propertyId) },
    { name: "create floor", allowed: ["owner", "manager"], run: (c) => createFloor(db, c, T.propertyId, { name: `F${++n}` }) },
    {
      name: "set housekeeping status",
      allowed: ["owner", "manager", "housekeeping"],
      run: (c) => changeRoomStatus(db, c, T.propertyId, roomId, { dimension: "housekeeping", status: "dirty" }),
    },
    {
      name: "take room out of order",
      allowed: ["owner", "manager"],
      run: (c) => changeRoomStatus(db, c, T.propertyId, roomId, { dimension: "operational", status: "active" }),
    },
    { name: "view QR", allowed: ["owner", "manager", "receptionist"], run: (c) => getRoomQr(db, c, T.propertyId, roomId) },
    {
      name: "replace QR",
      allowed: ["owner", "manager"],
      run: async (c) => {
        await rotateRoomQr(db, c, T.propertyId, roomId);
        qr = (await getRoomQr(db, T.ctx, T.propertyId, roomId)).active!.url.split("/r/")[1]!;
      },
    },
    { name: "edit guest portal / Wi-Fi", allowed: ["owner", "manager"], run: (c) => updatePortalSettings(db, c, T.propertyId, { enabled: "on" }) },
    {
      name: "manage services",
      allowed: ["owner", "manager"],
      run: (c) => createService(db, c, T.propertyId, { name: `S${++n}`, departmentId: svc.water.departmentId }),
    },
    { name: "view staff", allowed: ["owner", "manager"], run: (c) => listStaff(db, c) },
    {
      name: "invite receptionist",
      allowed: ["owner", "manager"],
      run: async (c) => {
        const [role] = await db.select().from(roles).where(and(isNull(roles.tenantId), eq(roles.key, "receptionist")));
        return createInvitation(db, c, { email: `m${++n}@example.test`, name: "X", roleId: role.id });
      },
    },
    { name: "create custom role", allowed: ["owner"], run: (c) => createRole(db, c, { name: `R${++n}`, permissions: ["audit.view"] }) },
    { name: "edit hotel settings", allowed: ["owner"], run: (c) => updateTenantSettings(db, c, { name: "Matrix Hotel", legalName: "Matrix Hotel Pvt Ltd", timezone: "Asia/Kolkata", country: "IN", currency: "INR", contactEmail: "owner@example.test" }) },
    { name: "view audit log", allowed: ["owner", "manager"], run: (c) => listTenantAuditLogs(db, c) },
    {
      name: "accept water request (Room Service)",
      allowed: ["owner", "manager", "receptionist", "room_service"],
      run: async (c) => transitionRequest(db, c, await request("water", { quantity: "1" }), "acknowledge"),
    },
    {
      name: "accept towels request (Housekeeping)",
      allowed: ["owner", "manager", "receptionist", "housekeeping"],
      run: async (c) => transitionRequest(db, c, await request("housekeeping", { option: "Extra towels" }), "acknowledge"),
    },
    {
      name: "accept AC problem (Maintenance)",
      allowed: ["owner", "manager", "receptionist", "maintenance"],
      run: async (c) => transitionRequest(db, c, await request("maintenance", { option: "Air conditioning" }), "acknowledge"),
    },
    {
      name: "cancel a request",
      allowed: ["owner", "manager", "receptionist"],
      run: async (c) => transitionRequest(db, c, await request("reception"), "cancel", { note: "matrix" }),
    },
    {
      name: "check a guest in",
      allowed: ["owner", "manager", "receptionist"],
      run: async (c) => checkIn(db, c, T.propertyId, { roomId: await freshRoom(), guestName: "Matrix Guest", checkoutDate: "2099-01-01" }),
    },
    { name: "view in-house guests", allowed: ["owner", "manager", "receptionist"], run: (c) => listInHouse(db, c, T.propertyId) },
    {
      name: "start cleaning a dirty room",
      allowed: ["owner", "manager", "housekeeping"],
      run: async (c) => {
        const r = await freshRoom();
        await changeRoomStatus(db, T.ctx, T.propertyId, r, { dimension: "housekeeping", status: "dirty" });
        return startCleaning(db, c, T.propertyId, r);
      },
    },
  ];

  const ctxFor: Partial<Record<SystemRoleKey, { wide: TenantContext; elsewhere: TenantContext }>> = {};

  beforeAll(async () => {
    db = await createTestDb();
    T = await createTenantFixture(db, { hotelName: "Matrix Hotel" });
    const floor = await createFloor(db, T.ctx, T.propertyId, { name: "Ground" });
    const cat = await createCategory(db, T.ctx, T.propertyId, { name: "Std", capacity: 2 });
    floorId = floor.id;
    catId = cat.id;
    roomId = (await createRoom(db, T.ctx, T.propertyId, { roomCode: "101", floorId: floor.id, categoryId: cat.id })).id;
    await createDefaultServices(db, T.ctx, T.propertyId);
    svc = Object.fromEntries((await listServices(db, T.ctx, T.propertyId)).items.map((i) => [i.key, i]));
    qr = (await getRoomQr(db, T.ctx, T.propertyId, roomId)).active!.url.split("/r/")[1]!;
    otherPropertyId = (await createProperty(db, T.ctx, { name: "Other wing", country: "IN", timezone: "Asia/Kolkata", currency: "INR" })).id;
    for (const role of ROLES) {
      ctxFor[role] = { wide: await addStaff(db, T, role, null), elsewhere: await addStaff(db, T, role, otherPropertyId) };
    }
  });
  beforeEach(async () => {
    await db.delete(rateLimits);
  });

  it("database role grants match the documented catalogue exactly", () => {
    for (const role of ROLES) {
      const ctx = ctxFor[role]!.wide;
      for (const p of ALL_PERMISSION_KEYS) {
        expect(can(ctx, p), `${role} / ${p}`).toBe(SYSTEM_ROLES[role].permissions.includes(p));
      }
    }
  });

  for (const op of OPS) {
    for (const role of ROLES) {
      const allowed = op.allowed.includes(role);
      it(`${allowed ? "ALLOW" : "DENY "} ${role.padEnd(12)} · ${op.name}`, async () => {
        const run = op.run(ctxFor[role]!.wide);
        if (allowed) await expect(run).resolves.not.toThrow();
        else await expect(run).rejects.toMatchObject({ code: expect.stringMatching(/forbidden|not_found/) });
      });
    }
  }

  for (const role of ROLES) {
    it(`DENY  ${role.padEnd(12)} · anything on a property outside their scope`, async () => {
      const c = ctxFor[role]!.elsewhere;
      await expect(listRooms(db, c, T.propertyId)).rejects.toMatchObject({ code: "forbidden" });
      await expect(getRoomQr(db, c, T.propertyId, roomId)).rejects.toMatchObject({ code: expect.stringMatching(/forbidden|not_found/) });
      await expect(updatePortalSettings(db, c, T.propertyId, { enabled: "on" })).rejects.toBeTruthy();
      expect(await listInbox(db, c, { view: "all" })).toEqual([]);
    });
  }
});
