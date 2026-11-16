import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/types";
import { auditLogs, housekeepingTasks, rooms, stays } from "@/lib/db/schema";
import { finishCleaning, inspectRoom, readinessBoard, setRequireInspection, startCleaning } from "@/modules/housekeeping/service";
import { createCategory } from "@/modules/rooms/categories";
import { createFloor } from "@/modules/rooms/floors";
import { changeRoomStatus, createRoom } from "@/modules/rooms/rooms";
import { checkIn, checkOut, currentStay, listAvailableRooms, listInHouse } from "@/modules/stays/service";
import { addStaff, createTenantFixture, createTestDb, type TenantFixture } from "../helpers/db";
import type { TenantContext } from "@/lib/permissions/authorize";

const tomorrow = () => new Date(Date.now() + 86400_000).toISOString().slice(0, 10);

describe("stays, check-in/out and housekeeping", () => {
  let db: Db;
  let A: TenantFixture;
  let B: TenantFixture;
  let hk1: TenantContext;
  let hk2: TenantContext;
  let reception: TenantContext;
  let floorId: string;
  let catId: string;

  const newRoom = async (code: string) =>
    (await createRoom(db, A.ctx, A.propertyId, { roomCode: code, floorId, categoryId: catId })).id;
  const tasksFor = (roomId: string) => db.select().from(housekeepingTasks).where(eq(housekeepingTasks.roomId, roomId));
  const roomRow = async (roomId: string) => (await db.select().from(rooms).where(eq(rooms.id, roomId)))[0];
  const guest = (roomId: string, name = "Asha Rao") =>
    checkIn(db, reception, A.propertyId, { roomId, guestName: name, phone: "+91 90000 00000", checkoutDate: tomorrow() });

  beforeAll(async () => {
    db = await createTestDb();
    A = await createTenantFixture(db, { hotelName: "Stay Hotel" });
    B = await createTenantFixture(db, { hotelName: "Other Hotel" });
    floorId = (await createFloor(db, A.ctx, A.propertyId, { name: "F1" })).id;
    catId = (await createCategory(db, A.ctx, A.propertyId, { name: "Std", capacity: 2 })).id;
    hk1 = await addStaff(db, A, "housekeeping", null);
    hk2 = await addStaff(db, A, "housekeeping", null);
    reception = await addStaff(db, A, "receptionist", null);
  });

  it("checks a guest into a ready room; one active stay per room", async () => {
    const roomId = await newRoom("101");
    expect((await listAvailableRooms(db, reception, A.propertyId)).map((r) => r.roomCode)).toContain("101");
    const stay = await guest(roomId);
    expect(stay.status).toBe("checked_in");
    await expect(guest(roomId, "Someone Else")).rejects.toMatchObject({ code: "conflict" });
    expect((await listAvailableRooms(db, reception, A.propertyId)).map((r) => r.roomCode)).not.toContain("101");
    const inHouse = await listInHouse(db, reception, A.propertyId);
    expect(inHouse.stays.map((s) => s.roomCode)).toEqual(["101"]);

    // Occupancy is visible on the board; guest identity is not (housekeeping doesn't need it).
    const board = await readinessBoard(db, hk1, A.propertyId);
    expect(board.items.find((i) => i.roomCode === "101")!.readiness).toBe("occupied");
    expect(JSON.stringify(board)).not.toContain("Asha");
    expect(await currentStay(db, hk1, A.propertyId, roomId)).toMatchObject({ guestName: null });
    expect(await currentStay(db, reception, A.propertyId, roomId)).toMatchObject({ guestName: "Asha Rao" });
  });

  it("refuses rooms that are out of order, blocked or not cleaned, and past checkout dates", async () => {
    const ooo = await newRoom("102");
    await changeRoomStatus(db, A.ctx, A.propertyId, ooo, { dimension: "operational", status: "out_of_order" });
    await expect(guest(ooo)).rejects.toThrow(/out of service/);
    const blocked = await newRoom("103");
    await changeRoomStatus(db, A.ctx, A.propertyId, blocked, { dimension: "housekeeping", status: "blocked" });
    await expect(guest(blocked)).rejects.toThrow(/out of service/);
    const dirty = await newRoom("104");
    await changeRoomStatus(db, A.ctx, A.propertyId, dirty, { dimension: "housekeeping", status: "dirty" });
    await expect(guest(dirty)).rejects.toThrow(/needs cleaning/);
    const ok = await newRoom("105");
    await expect(
      checkIn(db, reception, A.propertyId, { roomId: ok, guestName: "X", checkoutDate: "2020-01-01" }),
    ).rejects.toThrow(/future/);
  });

  it("stores expected checkout in the property's timezone", async () => {
    const roomId = await newRoom("106");
    const stay = await checkIn(db, reception, A.propertyId, { roomId, guestName: "Tz Test", checkoutDate: "2099-03-10", checkoutTime: "11:00" });
    expect(stay.expectedCheckoutAt.toISOString()).toBe("2099-03-10T05:30:00.000Z"); // Asia/Kolkata = UTC+5:30
  });

  it("checkout closes the stay, dirties the room and creates exactly one cleaning task (even when repeated)", async () => {
    const roomId = await newRoom("201");
    const stay = await guest(roomId);
    const res = await checkOut(db, reception, A.propertyId, stay.id);
    expect((await roomRow(roomId)).housekeepingStatus).toBe("dirty");
    const [s] = await db.select().from(stays).where(eq(stays.id, stay.id));
    expect(s).toMatchObject({ status: "checked_out" });
    expect(s.checkedOutAt).not.toBeNull();
    await expect(checkOut(db, reception, A.propertyId, stay.id)).rejects.toMatchObject({ code: "conflict" });
    const tasks = await tasksFor(roomId);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ id: res.cleaningTaskId, taskType: "cleaning", reason: "checkout", status: "open", stayId: stay.id });
    // Not ready: checkout never makes a room ready.
    expect((await listAvailableRooms(db, reception, A.propertyId)).map((r) => r.roomCode)).not.toContain("201");
    await expect(guest(roomId)).rejects.toThrow(/needs cleaning/);
  });

  it("concurrent checkouts: one wins, one task", async () => {
    const roomId = await newRoom("202");
    const stay = await guest(roomId);
    const results = await Promise.allSettled([
      checkOut(db, reception, A.propertyId, stay.id),
      checkOut(db, A.ctx, A.propertyId, stay.id),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await tasksFor(roomId)).toHaveLength(1);
  });

  it("the database refuses a second open task of the same type for a room", async () => {
    const roomId = await newRoom("203");
    const base = { tenantId: A.tenantId, propertyId: A.propertyId, roomId, taskType: "cleaning" as const };
    await db.insert(housekeepingTasks).values(base);
    await expect(db.insert(housekeepingTasks).values(base)).rejects.toThrow();
  });

  it("clean → inspect → ready, with separation of duties", async () => {
    const roomId = await newRoom("301");
    const stay = await guest(roomId);
    await checkOut(db, reception, A.propertyId, stay.id);

    await expect(finishCleaning(db, hk1, A.propertyId, roomId)).rejects.toThrow(/Start cleaning first/);
    await startCleaning(db, hk1, A.propertyId, roomId);
    expect((await readinessBoard(db, hk1, A.propertyId)).items.find((i) => i.id === roomId)!.readiness).toBe("cleaning");
    await expect(startCleaning(db, hk2, A.propertyId, roomId)).rejects.toMatchObject({ code: "conflict" });
    const done = await finishCleaning(db, hk1, A.propertyId, roomId, { note: "Changed linen" });
    expect(done.requiresInspection).toBe(true);
    expect((await roomRow(roomId)).housekeepingStatus).toBe("clean");
    expect((await readinessBoard(db, hk1, A.propertyId)).items.find((i) => i.id === roomId)!.readiness).toBe("awaiting_inspection");
    await expect(guest(roomId)).rejects.toThrow(/awaiting inspection/);

    // The cleaner cannot pass their own work; a colleague can.
    await expect(inspectRoom(db, hk1, A.propertyId, roomId, { passed: true })).rejects.toMatchObject({ code: "forbidden" });
    await inspectRoom(db, hk2, A.propertyId, roomId, { passed: true });
    expect((await roomRow(roomId)).housekeepingStatus).toBe("inspected");
    expect((await listAvailableRooms(db, reception, A.propertyId)).map((r) => r.id)).toContain(roomId);
    const tasks = await tasksFor(roomId);
    expect(tasks.map((t) => [t.taskType, t.status, t.outcome]).sort()).toEqual([
      ["cleaning", "done", null],
      ["inspection", "done", "passed"],
    ]);
  });

  it("failed inspection sends the room back to cleaning with the reason", async () => {
    const roomId = await newRoom("302");
    await changeRoomStatus(db, A.ctx, A.propertyId, roomId, { dimension: "housekeeping", status: "dirty" });
    await startCleaning(db, hk1, A.propertyId, roomId);
    await finishCleaning(db, hk1, A.propertyId, roomId);
    await expect(inspectRoom(db, hk2, A.propertyId, roomId, { passed: false })).rejects.toThrow(/redoing/);
    await inspectRoom(db, hk2, A.propertyId, roomId, { passed: false, note: "Bathroom mirror smudged" });
    expect((await roomRow(roomId)).housekeepingStatus).toBe("dirty");
    const open = (await tasksFor(roomId)).filter((t) => t.status === "open");
    expect(open).toEqual([expect.objectContaining({ taskType: "cleaning", reason: "inspection_failed", notes: "Bathroom mirror smudged" })]);
  });

  it("without the inspection policy, finished cleaning is ready immediately", async () => {
    await setRequireInspection(db, A.ctx, A.propertyId, false);
    const roomId = await newRoom("303");
    await changeRoomStatus(db, A.ctx, A.propertyId, roomId, { dimension: "housekeeping", status: "dirty" });
    await startCleaning(db, hk1, A.propertyId, roomId);
    expect((await finishCleaning(db, hk1, A.propertyId, roomId)).requiresInspection).toBe(false);
    expect((await listAvailableRooms(db, reception, A.propertyId)).map((r) => r.id)).toContain(roomId);
    await setRequireInspection(db, A.ctx, A.propertyId, true);
  });

  it("housekeepers cannot skip open work by setting the status by hand; managers can override (audited)", async () => {
    const roomId = await newRoom("304");
    const stay = await guest(roomId);
    await checkOut(db, reception, A.propertyId, stay.id);
    await expect(
      changeRoomStatus(db, hk1, A.propertyId, roomId, { dimension: "housekeeping", status: "inspected" }),
    ).rejects.toThrow(/open housekeeping work/);
    await changeRoomStatus(db, A.ctx, A.propertyId, roomId, { dimension: "housekeeping", status: "inspected", note: "Checked personally" });
    expect((await tasksFor(roomId)).every((t) => t.status === "cancelled")).toBe(true);
    const audit = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "room.housekeeping_override"), eq(auditLogs.entityId, roomId)));
    expect(audit).toHaveLength(1);
  });

  it("enforces permissions and tenant isolation", async () => {
    const roomId = await newRoom("401");
    await expect(checkIn(db, hk1, A.propertyId, { roomId, guestName: "X", checkoutDate: tomorrow() })).rejects.toMatchObject({ code: "forbidden" });
    await expect(startCleaning(db, reception, A.propertyId, roomId)).rejects.toMatchObject({ code: "forbidden" });
    await expect(listInHouse(db, hk1, A.propertyId)).rejects.toMatchObject({ code: "forbidden" });
    const stay = await guest(roomId);
    await expect(checkOut(db, B.ctx, A.propertyId, stay.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(checkOut(db, B.ctx, B.propertyId, stay.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(readinessBoard(db, B.ctx, A.propertyId)).rejects.toMatchObject({ code: "not_found" });
    await expect(setRequireInspection(db, reception, A.propertyId, false)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("audit entries never contain guest names or contact details", async () => {
    const rows = await db.select().from(auditLogs).where(eq(auditLogs.tenantId, A.tenantId));
    const blob = JSON.stringify(rows);
    expect(rows.some((r) => r.action === "stay.checked_in")).toBe(true);
    expect(blob).not.toContain("Asha");
    expect(blob).not.toContain("90000");
  });
});
