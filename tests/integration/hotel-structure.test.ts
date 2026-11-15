import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/lib/db/types";
import { roles, rooms, roomStatusHistory, tenantMemberships, userRoleAssignments, users } from "@/lib/db/schema";
import type { TenantContext } from "@/lib/permissions/authorize";
import { createProperty } from "@/modules/properties/service";
import { createFloor, listFloors, setFloorArchived, updateFloor } from "@/modules/rooms/floors";
import { createCategory, listCategories, setCategoryArchived } from "@/modules/rooms/categories";
import {
  bulkCreateRooms,
  changeRoomStatus,
  createRoom,
  getRoom,
  listRoomHistory,
  listRooms,
  roomStatusSummary,
  setRoomArchived,
  updateRoom,
} from "@/modules/rooms/rooms";
import { createDefaultDepartments, createDepartment, listDepartments, updateDepartment } from "@/modules/departments/service";
import { loadTenantContext } from "@/modules/tenants/context";
import { createTestDb, createTenantFixture } from "../helpers/db";

type Fixture = Awaited<ReturnType<typeof createTenantFixture>>;

async function setupStructure(db: Db, t: Fixture) {
  const floor = await createFloor(db, t.ctx, t.propertyId, { name: "Floor 1", sortOrder: 1 });
  const category = await createCategory(db, t.ctx, t.propertyId, { name: "Deluxe", capacity: 2 });
  return { floor, category };
}

async function addStaff(db: Db, t: Fixture, roleKey: string, propertyId: string | null): Promise<TenantContext> {
  const [user] = await db
    .insert(users)
    .values({ email: `${roleKey}-${crypto.randomUUID()}@example.test`, name: roleKey, passwordHash: "x" })
    .returning();
  const [m] = await db.insert(tenantMemberships).values({ tenantId: t.tenantId, userId: user.id }).returning();
  const [role] = await db.select().from(roles).where(and(isNull(roles.tenantId), eq(roles.key, roleKey)));
  await db.insert(userRoleAssignments).values({ tenantId: t.tenantId, membershipId: m.id, roleId: role.id, propertyId });
  return (await loadTenantContext(db, user.id, t.tenantId))!;
}

describe("floors, room types and rooms", () => {
  let db: Db;
  let A: Fixture;
  let s: Awaited<ReturnType<typeof setupStructure>>;

  beforeAll(async () => {
    db = await createTestDb();
    A = await createTenantFixture(db, { hotelName: "Structure Hotel" });
    s = await setupStructure(db, A);
  });

  it("creates a room and enforces unique room codes per property (case-insensitive)", async () => {
    await createRoom(db, A.ctx, A.propertyId, { roomCode: "A101", floorId: s.floor.id, categoryId: s.category.id });
    await expect(
      createRoom(db, A.ctx, A.propertyId, { roomCode: "a101", floorId: s.floor.id, categoryId: s.category.id }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("allows the same room code in a different property", async () => {
    const p2 = await createProperty(db, A.ctx, { name: "Second", country: "IN", timezone: "Asia/Kolkata", currency: "INR" });
    const f = await createFloor(db, A.ctx, p2.id, { name: "G" });
    const c = await createCategory(db, A.ctx, p2.id, { name: "Std", capacity: 2 });
    await expect(createRoom(db, A.ctx, p2.id, { roomCode: "A101", floorId: f.id, categoryId: c.id })).resolves.toBeDefined();
  });

  it("rejects a floor from another property of the same tenant", async () => {
    const p3 = await createProperty(db, A.ctx, { name: "Third", country: "IN", timezone: "Asia/Kolkata", currency: "INR" });
    const otherFloor = await createFloor(db, A.ctx, p3.id, { name: "X" });
    await expect(
      createRoom(db, A.ctx, A.propertyId, { roomCode: "Z1", floorId: otherFloor.id, categoryId: s.category.id }),
    ).rejects.toThrow(/floor of this property/);
  });

  it("validates room input", async () => {
    await expect(
      createRoom(db, A.ctx, A.propertyId, { roomCode: "<script>", floorId: s.floor.id, categoryId: s.category.id }),
    ).rejects.toThrow();
    await expect(createCategory(db, A.ctx, A.propertyId, { name: "Zero", capacity: 0 })).rejects.toThrow();
  });

  it("bulk-creates a range and refuses overlaps atomically", async () => {
    const r = await bulkCreateRooms(db, A.ctx, A.propertyId, {
      floorId: s.floor.id, categoryId: s.category.id, prefix: "", start: 101, end: 110,
    });
    expect(r.count).toBe(10);
    await expect(
      bulkCreateRooms(db, A.ctx, A.propertyId, { floorId: s.floor.id, categoryId: s.category.id, start: 108, end: 115 }),
    ).rejects.toThrow(/already exist: 108, 109, 110/);
    const { total } = await listRooms(db, A.ctx, A.propertyId, { q: "11" });
    expect(total).toBe(1); // only 110 matches; 111–115 were not created
    await expect(
      bulkCreateRooms(db, A.ctx, A.propertyId, { floorId: s.floor.id, categoryId: s.category.id, start: 1, end: 500 }),
    ).rejects.toThrow();
  });

  it("filters, searches and paginates in natural order", async () => {
    const page1 = await listRooms(db, A.ctx, A.propertyId, { pageSize: 4 });
    expect(page1.total).toBe(11);
    expect(page1.pageCount).toBe(3);
    expect(page1.items.map((r) => r.roomCode)).toEqual(["101", "102", "103", "104"]);
    const page3 = await listRooms(db, A.ctx, A.propertyId, { pageSize: 4, page: 3 });
    expect(page3.items.map((r) => r.roomCode)).toEqual(["109", "110", "A101"]);
    // LIKE wildcards are treated literally.
    expect((await listRooms(db, A.ctx, A.propertyId, { q: "%" })).total).toBe(0);
    // Invalid filter values are ignored instead of erroring.
    expect((await listRooms(db, A.ctx, A.propertyId, { operational: "nonsense" as never })).total).toBe(11);
  });

  it("keeps operational and housekeeping status separate, with history", async () => {
    const { items } = await listRooms(db, A.ctx, A.propertyId, { q: "101", pageSize: 1 });
    const room = items[0];
    await changeRoomStatus(db, A.ctx, A.propertyId, room.id, { dimension: "operational", status: "out_of_order", note: "AC broken" });
    await changeRoomStatus(db, A.ctx, A.propertyId, room.id, { dimension: "housekeeping", status: "dirty" });
    const after = await getRoom(db, A.ctx, A.propertyId, room.id);
    expect(after.operationalStatus).toBe("out_of_order");
    expect(after.housekeepingStatus).toBe("dirty");
    // No-op change does not add history.
    await changeRoomStatus(db, A.ctx, A.propertyId, room.id, { dimension: "housekeeping", status: "dirty" });
    const history = await listRoomHistory(db, A.ctx, A.propertyId, room.id);
    expect(history.map((h) => `${h.dimension}:${h.fromStatus}->${h.toStatus}`)).toEqual([
      "housekeeping:clean->dirty",
      "operational:active->out_of_order",
    ]);
    expect(history[1].note).toBe("AC broken");

    const filtered = await listRooms(db, A.ctx, A.propertyId, { operational: "out_of_order" });
    expect(filtered.items.map((r) => r.id)).toEqual([room.id]);
    const summary = await roomStatusSummary(db, A.ctx, A.propertyId);
    expect(summary.total).toBe(11);
    expect(summary.operational.out_of_order).toBe(1);
    expect(summary.housekeeping.dirty).toBe(1);
  });

  it("updates rooms and uses category capacity unless overridden", async () => {
    const { items } = await listRooms(db, A.ctx, A.propertyId, { q: "102" });
    expect(items[0].capacity).toBe(2);
    await updateRoom(db, A.ctx, A.propertyId, items[0].id, {
      roomCode: "102", floorId: s.floor.id, categoryId: s.category.id, capacity: "4", notes: "Sea view",
    });
    const again = await listRooms(db, A.ctx, A.propertyId, { q: "102" });
    expect(again.items[0].capacity).toBe(4);
  });

  it("archives rooms, hides them, frees the code, and blocks status changes", async () => {
    const { items } = await listRooms(db, A.ctx, A.propertyId, { q: "103" });
    await setRoomArchived(db, A.ctx, A.propertyId, items[0].id, true);
    expect((await listRooms(db, A.ctx, A.propertyId, { q: "103" })).total).toBe(0);
    expect((await listRooms(db, A.ctx, A.propertyId, { archived: "only" })).total).toBe(1);
    await expect(
      changeRoomStatus(db, A.ctx, A.propertyId, items[0].id, { dimension: "housekeeping", status: "clean" }),
    ).rejects.toMatchObject({ code: "conflict" });
    // Code can be reused by a new live room…
    const reused = await createRoom(db, A.ctx, A.propertyId, { roomCode: "103", floorId: s.floor.id, categoryId: s.category.id });
    // …and then the archived one cannot be restored with a clashing code.
    await expect(setRoomArchived(db, A.ctx, A.propertyId, items[0].id, false)).rejects.toMatchObject({ code: "conflict" });
    await setRoomArchived(db, A.ctx, A.propertyId, reused.id, true);
  });

  it("refuses to archive floors and room types that still have live rooms", async () => {
    await expect(setFloorArchived(db, A.ctx, A.propertyId, s.floor.id, true)).rejects.toThrow(/room\(s\) on this floor/);
    await expect(setCategoryArchived(db, A.ctx, A.propertyId, s.category.id, true)).rejects.toThrow(/room\(s\) using it/);
    const empty = await createFloor(db, A.ctx, A.propertyId, { name: "Roof" });
    await setFloorArchived(db, A.ctx, A.propertyId, empty.id, true);
    expect((await listFloors(db, A.ctx, A.propertyId)).some((f) => f.id === empty.id)).toBe(false);
    // Archived floors cannot receive rooms.
    await expect(
      createRoom(db, A.ctx, A.propertyId, { roomCode: "R1", floorId: empty.id, categoryId: s.category.id }),
    ).rejects.toThrow(/floor of this property/);
  });

  it("rejects duplicate floor and room type names", async () => {
    await expect(createFloor(db, A.ctx, A.propertyId, { name: "floor 1" })).rejects.toMatchObject({ code: "conflict" });
    await expect(createCategory(db, A.ctx, A.propertyId, { name: "DELUXE", capacity: 2 })).rejects.toMatchObject({ code: "conflict" });
    const other = await createFloor(db, A.ctx, A.propertyId, { name: "Floor 2", sortOrder: 2 });
    await expect(updateFloor(db, A.ctx, A.propertyId, other.id, { name: "Floor 1" })).rejects.toMatchObject({ code: "conflict" });
    expect((await listCategories(db, A.ctx, A.propertyId))[0].roomCount).toBeGreaterThan(0);
  });

  it("writes audit entries for structure changes", async () => {
    const { auditLogs } = await import("@/lib/db/schema");
    const actions = (await db.select().from(auditLogs).where(eq(auditLogs.tenantId, A.tenantId))).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "floor.created", "room_category.created", "room.created", "room.bulk_created",
        "room.operational_status_changed", "room.updated", "room.archived", "floor.archived",
      ]),
    );
  });
});

describe("departments", () => {
  let db: Db;
  let A: Fixture;
  beforeAll(async () => {
    db = await createTestDb();
    A = await createTenantFixture(db);
  });

  it("creates default departments idempotently", async () => {
    expect((await createDefaultDepartments(db, A.ctx, A.propertyId)).created).toBe(5);
    expect((await createDefaultDepartments(db, A.ctx, A.propertyId)).created).toBe(0);
    const list = await listDepartments(db, A.ctx, A.propertyId);
    expect(list.map((d) => d.key).sort()).toEqual(["housekeeping", "maintenance", "reception", "room_service", "security"]);
  });

  it("adds custom departments, keeps keys stable on rename, rejects duplicates", async () => {
    const d = await createDepartment(db, A.ctx, A.propertyId, { name: "Front Desk" });
    expect(d.key).toBe("front_desk");
    const renamed = await updateDepartment(db, A.ctx, A.propertyId, d.id, { name: "Guest Relations", status: "inactive" });
    expect(renamed.key).toBe("front_desk");
    expect(renamed.status).toBe("inactive");
    await expect(createDepartment(db, A.ctx, A.propertyId, { name: "reception" })).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("Phase 2 isolation: tenants, properties and roles", () => {
  let db: Db;
  let A: Fixture;
  let B: Fixture;
  let a: Awaited<ReturnType<typeof setupStructure>>;
  let b: Awaited<ReturnType<typeof setupStructure>>;
  let roomA: string;
  let roomB: string;

  beforeAll(async () => {
    db = await createTestDb();
    A = await createTenantFixture(db, { hotelName: "Iso A" });
    B = await createTenantFixture(db, { hotelName: "Iso B" });
    a = await setupStructure(db, A);
    b = await setupStructure(db, B);
    roomA = (await createRoom(db, A.ctx, A.propertyId, { roomCode: "1", floorId: a.floor.id, categoryId: a.category.id })).id;
    roomB = (await createRoom(db, B.ctx, B.propertyId, { roomCode: "1", floorId: b.floor.id, categoryId: b.category.id })).id;
  });

  it("Tenant A cannot list, read, edit, re-status or archive Tenant B's rooms", async () => {
    await expect(listRooms(db, A.ctx, B.propertyId)).rejects.toMatchObject({ code: "not_found" });
    await expect(listFloors(db, A.ctx, B.propertyId)).rejects.toMatchObject({ code: "not_found" });
    await expect(listDepartments(db, A.ctx, B.propertyId)).rejects.toMatchObject({ code: "not_found" });
    // Even with A's own property id, B's room id is not found.
    await expect(getRoom(db, A.ctx, A.propertyId, roomB)).rejects.toMatchObject({ code: "not_found" });
    await expect(
      changeRoomStatus(db, A.ctx, A.propertyId, roomB, { dimension: "operational", status: "inactive" }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(setRoomArchived(db, A.ctx, A.propertyId, roomB, true)).rejects.toMatchObject({ code: "not_found" });
    const [rowB] = await db.select().from(rooms).where(eq(rooms.id, roomB));
    expect(rowB.operationalStatus).toBe("active");
    expect(rowB.archivedAt).toBeNull();
  });

  it("Tenant A cannot attach a room to Tenant B's floor or room type", async () => {
    await expect(
      createRoom(db, A.ctx, A.propertyId, { roomCode: "X", floorId: b.floor.id, categoryId: a.category.id }),
    ).rejects.toThrow(/floor of this property/);
    await expect(
      createRoom(db, A.ctx, A.propertyId, { roomCode: "X", floorId: a.floor.id, categoryId: b.category.id }),
    ).rejects.toThrow(/room type of this property/);
  });

  it("the database itself rejects cross-tenant and cross-property parent links", async () => {
    await expect(
      db.insert(rooms).values({
        tenantId: A.tenantId, propertyId: A.propertyId, floorId: b.floor.id, categoryId: a.category.id, roomCode: "DB1",
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(roomStatusHistory).values({
        tenantId: A.tenantId, propertyId: A.propertyId, roomId: roomB, dimension: "operational", toStatus: "inactive",
      }),
    ).rejects.toThrow();
  });

  it("property-scoped staff only reach their own property", async () => {
    const p2 = await createProperty(db, A.ctx, { name: "Iso A2", country: "IN", timezone: "Asia/Kolkata", currency: "INR" });
    const rec = await addStaff(db, A, "receptionist", p2.id);
    await expect(listRooms(db, rec, p2.id)).resolves.toBeDefined();
    await expect(listRooms(db, rec, A.propertyId)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("housekeeping can change housekeeping status but not operational status or structure", async () => {
    const hk = await addStaff(db, A, "housekeeping", null);
    await expect(
      changeRoomStatus(db, hk, A.propertyId, roomA, { dimension: "housekeeping", status: "in_progress" }),
    ).resolves.toMatchObject({ housekeepingStatus: "in_progress" });
    await expect(
      changeRoomStatus(db, hk, A.propertyId, roomA, { dimension: "operational", status: "out_of_order" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(createFloor(db, hk, A.propertyId, { name: "HK floor" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(createDefaultDepartments(db, hk, A.propertyId)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("receptionists can view rooms but not manage them", async () => {
    const rec = await addStaff(db, A, "receptionist", null);
    await expect(listRooms(db, rec, A.propertyId)).resolves.toBeDefined();
    await expect(
      createRoom(db, rec, A.propertyId, { roomCode: "R9", floorId: a.floor.id, categoryId: a.category.id }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("suspended tenants cannot change structure or status", async () => {
    const suspended = { ...A.ctx, tenantStatus: "suspended" as const };
    await expect(createFloor(db, suspended, A.propertyId, { name: "S" })).rejects.toMatchObject({ code: "tenant_inactive" });
    await expect(
      changeRoomStatus(db, suspended, A.propertyId, roomA, { dimension: "housekeeping", status: "clean" }),
    ).rejects.toMatchObject({ code: "tenant_inactive" });
    await expect(listRooms(db, suspended, A.propertyId)).resolves.toBeDefined();
  });
});
