import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/types";
import { folioCharges, menuItems, rateLimits, requestItems, serviceItems, serviceRequests } from "@/lib/db/schema";
import { formatMoney, moneySchema } from "@/lib/money";
import type { TenantContext } from "@/lib/permissions/authorize";
import { addDays, localDate } from "@/lib/timezones";
import { addCharge, getFolio, recordPayment, voidCharge } from "@/modules/ordering/folio";
import { archiveMenuItem, createMenuItem, listMenu, updateMenuItem } from "@/modules/ordering/menu";
import { getRoomQr } from "@/modules/qr/service";
import { getGuestRequestStatus, getGuestServiceForm, submitGuestRequest, type GuestRequestInput } from "@/modules/requests/guest";
import { getRequestForStaff, transitionRequest } from "@/modules/requests/staff";
import { createCategory } from "@/modules/rooms/categories";
import { createFloor } from "@/modules/rooms/floors";
import { createRoom } from "@/modules/rooms/rooms";
import { createDefaultServices, createModuleServices, listServices, updateService } from "@/modules/services/catalog";
import { checkIn, checkOut } from "@/modules/stays/service";
import { addStaff, createTenantFixture, createTestDb, type TenantFixture } from "../helpers/db";

let ipN = 0;
const ip = () => `203.0.113.${++ipN % 250}`;

describe("ordering, bookings and guest bills (Phase 9)", () => {
  let db: Db;
  let A: TenantFixture;
  let B: TenantFixture;
  let reception: TenantContext;
  let roomService: TenantContext;
  let housekeeper: TenantContext;
  let roomId: string;
  let qr: string;
  let room2Id: string;
  let svc: Record<string, Awaited<ReturnType<typeof listServices>>["items"][number]>;
  let menu: Record<string, string>;

  const submit = (token: string, input: Partial<GuestRequestInput> & { serviceId: string }, now?: Date) =>
    submitGuestRequest(db, token, { idempotencyKey: crypto.randomUUID(), ...input }, { ip: ip(), now });

  const serviceInput = (s: (typeof svc)[string], over: Record<string, unknown> = {}) => ({
    name: s.name,
    departmentId: s.departmentId,
    icon: s.icon,
    enabled: true,
    maxQuantity: s.maxQuantity,
    options: s.options.join("\n"),
    noteMode: s.noteMode,
    availableFrom: s.availableFrom ?? "",
    availableTo: s.availableTo ?? "",
    priority: s.priority,
    targetMinutes: s.targetMinutes,
    escalate: true,
    kind: s.kind,
    allowRoomCharge: true,
    ...over,
  });

  beforeAll(async () => {
    db = await createTestDb();
    A = await createTenantFixture(db, { hotelName: "Dining Hotel" });
    B = await createTenantFixture(db, { hotelName: "Other Dining Hotel" });
    reception = await addStaff(db, A, "receptionist", null);
    roomService = await addStaff(db, A, "room_service", null);
    housekeeper = await addStaff(db, A, "housekeeping", null);
    const floor = await createFloor(db, A.ctx, A.propertyId, { name: "F1" });
    const cat = await createCategory(db, A.ctx, A.propertyId, { name: "Std", capacity: 2 });
    roomId = (await createRoom(db, A.ctx, A.propertyId, { roomCode: "101", floorId: floor.id, categoryId: cat.id })).id;
    room2Id = (await createRoom(db, A.ctx, A.propertyId, { roomCode: "102", floorId: floor.id, categoryId: cat.id })).id;
    await createDefaultServices(db, A.ctx, A.propertyId);
    expect((await createModuleServices(db, A.ctx, A.propertyId)).count).toBe(5);
    expect((await createModuleServices(db, A.ctx, A.propertyId)).count).toBe(0); // idempotent
    const { items } = await listServices(db, A.ctx, A.propertyId);
    svc = Object.fromEntries(items.map((i) => [i.key, i]));
    // The module pack arrives hidden; enable dining, laundry and spa for these tests.
    for (const k of ["dining", "laundry", "spa"]) await updateService(db, A.ctx, A.propertyId, svc[k].id, serviceInput(svc[k]) as never);
    const { items: dish } = await listMenu(db, A.ctx, A.propertyId, svc.dining.id);
    menu = Object.fromEntries(dish.map((m) => [m.name, m.id]));
    qr = (await getRoomQr(db, A.ctx, A.propertyId, roomId)).active!.url.split("/r/")[1]!;
  });

  beforeEach(async () => {
    await db.delete(rateLimits);
  });

  it("money helpers parse and format minor units", () => {
    expect(moneySchema("INR").parse("250")).toBe(25000);
    expect(moneySchema("INR").parse("250.5")).toBe(25050);
    expect(moneySchema("JPY").parse("300")).toBe(300);
    expect(() => moneySchema("INR").parse("2.555")).toThrow();
    expect(() => moneySchema("INR").parse("-5")).toThrow();
    expect(moneySchema("INR", { allowNegative: true }).parse("-5")).toBe(-500);
    expect(formatMoney(25050, "INR")).toBe("₹250.50");
  });

  it("module pack: hidden services with sample menus priced in the property currency", async () => {
    const [laundry] = await db.select().from(serviceItems).where(eq(serviceItems.id, svc.wakeup.id));
    expect(laundry).toMatchObject({ kind: "booking", enabled: false });
    expect(svc.dining.kind).toBe("menu");
    const [chai] = await db.select().from(menuItems).where(eq(menuItems.id, menu["Masala chai"]));
    expect(chai.priceMinor).toBe(9000);
  });

  it("menu management: validation, duplicates, archive; another tenant can't touch it", async () => {
    const item = await createMenuItem(db, A.ctx, A.propertyId, svc.dining.id, { name: "Paneer tikka", price: "380", section: "Mains", available: "on" });
    expect(item.priceMinor).toBe(38000);
    await expect(createMenuItem(db, A.ctx, A.propertyId, svc.dining.id, { name: "paneer TIKKA", price: "1" })).rejects.toThrow(/already on the menu/);
    await expect(createMenuItem(db, A.ctx, A.propertyId, svc.dining.id, { name: "Bad", price: "abc" })).rejects.toThrow();
    await expect(createMenuItem(db, A.ctx, A.propertyId, svc.water.id, { name: "X", price: "1" })).rejects.toThrow(/Only menu services/);
    await expect(createMenuItem(db, reception, A.propertyId, svc.dining.id, { name: "X", price: "1" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(updateMenuItem(db, B.ctx, B.propertyId, item.id, { name: "Hack", price: "1" })).rejects.toMatchObject({ code: "not_found" });
    await archiveMenuItem(db, A.ctx, A.propertyId, item.id);
    const { items } = await listMenu(db, A.ctx, A.propertyId, svc.dining.id);
    expect(items.map((i) => i.name)).not.toContain("Paneer tikka");
  });

  it("guest order is priced on the server; lines and total are snapshotted", async () => {
    const form = await getGuestServiceForm(db, qr, svc.dining.id, { ip: ip() });
    expect(form!.menu.length).toBeGreaterThan(0);
    expect(form!.canChargeRoom).toBe(false); // nobody checked in yet
    const res = await submit(qr, {
      serviceId: svc.dining.id,
      items: { [menu["Masala chai"]]: "2", [menu["Veg thali"]]: "1" },
      paymentMethod: "on_delivery",
    });
    expect(res.kind).toBe("ok");
    if (res.kind !== "ok") return;
    const [r] = await db.select().from(serviceRequests).where(eq(serviceRequests.id, res.requestId));
    expect(r).toMatchObject({ kind: "menu", totalMinor: 2 * 9000 + 45000, currency: "INR", paymentMethod: "on_delivery", quantity: 3 });
    const lines = await db.select().from(requestItems).where(eq(requestItems.requestId, r.id));
    expect(lines.map((l) => [l.name, l.quantity, l.lineTotalMinor]).sort()).toEqual([
      ["Masala chai", 2, 18000],
      ["Veg thali", 1, 45000],
    ]);
    // A later price change never rewrites the order.
    await updateMenuItem(db, A.ctx, A.propertyId, menu["Masala chai"], { name: "Masala chai", price: "100", section: "Drinks", available: "on" });
    const status = await getGuestRequestStatus(db, res.statusToken, { ip: ip() });
    expect(status.kind === "ok" && status.request.order).toMatchObject({ totalMinor: 63000, paymentMethod: "on_delivery" });
    const staffView = await getRequestForStaff(db, roomService, r.id);
    expect(staffView.items).toHaveLength(2);
  });

  it("refuses empty, oversized, foreign or unavailable lines", async () => {
    const bad = async (items: Record<string, string>) => {
      const res = await submit(qr, { serviceId: svc.dining.id, items });
      expect(res.kind).toBe("invalid");
      return res;
    };
    await bad({});
    await bad({ [menu["Masala chai"]]: "21" });
    await bad({ [crypto.randomUUID()]: "1" });
    await bad({ [menu["Masala chai"]]: "-1" });
    // Laundry items can't be ordered through the dining service.
    const { items: laundry } = await listMenu(db, A.ctx, A.propertyId, svc.laundry.id);
    await bad({ [laundry[0].id]: "1" });
    // Sold out = unavailable.
    await updateMenuItem(db, A.ctx, A.propertyId, menu["Idli sambar"], { name: "Idli sambar", price: "180", section: "Breakfast" });
    const res = await bad({ [menu["Idli sambar"]]: "1" });
    expect(res.kind === "invalid" && res.message).toMatch(/no longer available/);
  });

  it("room charge needs a checked-in stay; posts once on completion, voids on cancel; checkout guards the balance", async () => {
    const noStay = await submit(qr, { serviceId: svc.dining.id, items: { [menu["Masala chai"]]: "1" }, paymentMethod: "room" });
    expect(noStay).toMatchObject({ kind: "invalid", fieldErrors: { paymentMethod: [expect.stringMatching(/isn't available/)] } });

    const stay = await checkIn(db, reception, A.propertyId, { roomId, guestName: "Nisha", checkoutDate: addDays(localDate(new Date(), "Asia/Kolkata"), 2) });
    expect((await getGuestServiceForm(db, qr, svc.dining.id, { ip: ip() }))!.canChargeRoom).toBe(true);
    const res = await submit(qr, { serviceId: svc.dining.id, items: { [menu["Masala chai"]]: "3" }, paymentMethod: "room" });
    if (res.kind !== "ok") throw new Error(res.kind);
    let folio = await getFolio(db, reception, A.propertyId, stay.id);
    expect(folio.balance).toBe(0);
    expect(folio.pending).toHaveLength(1);

    await transitionRequest(db, roomService, res.requestId, "acknowledge");
    await transitionRequest(db, roomService, res.requestId, "start");
    await transitionRequest(db, roomService, res.requestId, "complete");
    folio = await getFolio(db, reception, A.propertyId, stay.id);
    expect(folio.charges).toHaveLength(1);
    expect(folio.balance).toBe(30000);
    // Reopen + complete again never double-charges.
    await transitionRequest(db, A.ctx, res.requestId, "reopen", { note: "Missing sugar" });
    await transitionRequest(db, roomService, res.requestId, "start");
    await transitionRequest(db, roomService, res.requestId, "complete");
    expect((await getFolio(db, reception, A.propertyId, stay.id)).charges).toHaveLength(1);

    // A second order is cancelled after completion+reopen: its charge is voided.
    const res2 = await submit(qr, { serviceId: svc.dining.id, items: { [menu["Veg thali"]]: "1" }, paymentMethod: "room" });
    if (res2.kind !== "ok") throw new Error(res2.kind);
    await transitionRequest(db, roomService, res2.requestId, "acknowledge");
    await transitionRequest(db, roomService, res2.requestId, "start");
    await transitionRequest(db, roomService, res2.requestId, "complete");
    await transitionRequest(db, A.ctx, res2.requestId, "reopen", { note: "Wrong dish" });
    await transitionRequest(db, A.ctx, res2.requestId, "start");
    await transitionRequest(db, A.ctx, res2.requestId, "cancel", { note: "Guest declined" });
    const [voided] = await db.select().from(folioCharges).where(eq(folioCharges.requestId, res2.requestId));
    expect(voided.voidedAt).not.toBeNull();
    expect((await getFolio(db, reception, A.propertyId, stay.id)).balance).toBe(30000);

    // Manual charge, discount and void.
    await addCharge(db, reception, A.propertyId, stay.id, { description: "Minibar", amount: "150" });
    const disc = await addCharge(db, reception, A.propertyId, stay.id, { description: "Discount", amount: "-50" });
    await expect(addCharge(db, reception, A.propertyId, stay.id, { description: "Zero", amount: "0" })).rejects.toThrow();
    await expect(voidCharge(db, reception, A.propertyId, disc.charge.id, {})).rejects.toThrow();
    await voidCharge(db, reception, A.propertyId, disc.charge.id, { reason: "Not approved" });
    await expect(voidCharge(db, reception, A.propertyId, disc.charge.id, { reason: "again" })).rejects.toThrow(/already void/);
    expect((await getFolio(db, reception, A.propertyId, stay.id)).balance).toBe(45000);

    // Checkout requires settling or an explicit decision.
    await expect(checkOut(db, reception, A.propertyId, stay.id)).rejects.toThrow(/Balance due: ₹450.00/);
    await recordPayment(db, reception, A.propertyId, stay.id, { amount: "400", method: "upi", reference: "UTR123" });
    await expect(checkOut(db, reception, A.propertyId, stay.id)).rejects.toThrow(/₹50.00/);
    await expect(recordPayment(db, reception, A.propertyId, stay.id, { amount: "10", method: "bitcoin" })).rejects.toThrow();
    await recordPayment(db, reception, A.propertyId, stay.id, { amount: "50", method: "cash" });
    await checkOut(db, reception, A.propertyId, stay.id);
  });

  it("checkout with balance due is allowed when explicitly chosen", async () => {
    const stay = await checkIn(db, reception, A.propertyId, {
      roomId: room2Id,
      guestName: "Open Bill",
      checkoutDate: addDays(localDate(new Date(), "Asia/Kolkata"), 1),
    });
    await addCharge(db, reception, A.propertyId, stay.id, { description: "Late checkout", amount: "500" });
    await checkOut(db, reception, A.propertyId, stay.id, { allowBalance: "on" });
    expect((await getFolio(db, reception, A.propertyId, stay.id)).balance).toBe(50000);
  });

  it("folio permissions and isolation", async () => {
    const stay = (await db.select().from(folioCharges).limit(1))[0].stayId;
    await expect(getFolio(db, housekeeper, A.propertyId, stay)).rejects.toMatchObject({ code: "forbidden" });
    await expect(getFolio(db, B.ctx, A.propertyId, stay)).rejects.toMatchObject({ code: "not_found" });
    await expect(getFolio(db, B.ctx, B.propertyId, stay)).rejects.toMatchObject({ code: "not_found" });
    await expect(addCharge(db, roomService, A.propertyId, stay, { description: "X", amount: "1" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("bookings: future time within hours and horizon; staff see the requested time", async () => {
    const today = localDate(new Date(), "Asia/Kolkata");
    const tomorrow = addDays(today, 1);
    const base = { serviceId: svc.spa.id, option: svc.spa.options[0] };
    expect(await submit(qr, { ...base })).toMatchObject({ kind: "invalid", fieldErrors: { scheduledTime: expect.anything() } });
    expect(await submit(qr, { ...base, scheduledDate: tomorrow, scheduledTime: "22:30" })).toMatchObject({
      kind: "invalid",
      message: expect.stringMatching(/between 09:00 and 21:00/),
    });
    expect(await submit(qr, { ...base, scheduledDate: addDays(today, 20), scheduledTime: "10:00" })).toMatchObject({
      kind: "invalid",
      message: expect.stringMatching(/14 days/),
    });
    expect(await submit(qr, { ...base, scheduledDate: addDays(today, -1), scheduledTime: "10:00" })).toMatchObject({ kind: "invalid" });
    const ok = await submit(qr, { ...base, scheduledDate: tomorrow, scheduledTime: "10:30" });
    if (ok.kind !== "ok") throw new Error(ok.kind);
    const [r] = await db.select().from(serviceRequests).where(eq(serviceRequests.id, ok.requestId));
    expect(r.kind).toBe("booking");
    expect(localDate(r.scheduledFor!, "Asia/Kolkata")).toBe(tomorrow);
    // Bookable outside the spa's hours (the hours apply to the chosen time).
    const night = new Date(`${today}T17:30:00Z`); // 23:00 IST
    expect((await submit(qr, { ...base, scheduledDate: tomorrow, scheduledTime: "11:00" }, night)).kind).toBe("ok");
  });
});
