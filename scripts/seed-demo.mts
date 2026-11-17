/**
 * Creates a fully set-up DEMO hotel for sales demos and pilots:
 *   - owner account (also promoted to SaaS platform admin when DEMO_PLATFORM_ADMIN=1);
 *   - 3 floors, 3 room types, 25 rooms with active QR codes;
 *   - standard services + dining/laundry/spa/taxi/wake-up (enabled, sample menus);
 *   - guest portal (Wi-Fi, phone, times, info sections, brand colour);
 *   - staff for every role; demo bookings, in-house guests, requests and a guest bill;
 *   - 90-day trial on the default plan.
 *
 * Credentials come from the environment so they never appear in code or git history:
 *   DEMO_ADMIN_EMAIL, DEMO_ADMIN_PASSWORD, DEMO_STAFF_PASSWORD, [DEMO_PLATFORM_ADMIN=1]
 *   pnpm demo:seed
 * Refuses to run if the admin email already exists.
 */
import { and, eq, isNull } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import { hashPassword, normalizeEmail } from "../lib/auth/password";
import { addDays, localDate } from "../lib/timezones";
import { writeAudit } from "../modules/audit/service";
import { updatePortalSettings } from "../modules/guest-portal/settings";
import { addCharge } from "../modules/ordering/folio";
import { listMenu } from "../modules/ordering/menu";
import { extendTrial } from "../modules/platform/service";
import { getRoomQr } from "../modules/qr/service";
import { submitGuestRequest } from "../modules/requests/guest";
import { transitionRequest } from "../modules/requests/staff";
import { createReservation } from "../modules/reservations/service";
import { createCategory } from "../modules/rooms/categories";
import { createFloor } from "../modules/rooms/floors";
import { bulkCreateRooms, listRooms } from "../modules/rooms/rooms";
import { createDefaultServices, createModuleServices, listServices, updateService } from "../modules/services/catalog";
import { checkIn } from "../modules/stays/service";
import { loadTenantContext } from "../modules/tenants/context";
import { createTenantWithOwner } from "../modules/tenants/onboarding";
import { scriptDb } from "./db.mts";

// tsx loads the schema barrel as CommonJS here; take the real exports from its default.
const { roles, tenantMemberships, userRoleAssignments, users } = ((schema as unknown as { default?: typeof schema }).default ?? schema) as typeof schema;

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Set ${k}`);
  return v;
};
const adminEmail = normalizeEmail(need("DEMO_ADMIN_EMAIL"));
const adminPassword = need("DEMO_ADMIN_PASSWORD");
const staffPassword = need("DEMO_STAFF_PASSWORD");
const makePlatformAdmin = process.env.DEMO_PLATFORM_ADMIN === "1";

const HOTEL = "Grand Stay Demo Hotel";
const STAFF_DOMAIN = "grandstay.example.com"; // reserved domain: never a real mailbox
const TZ = "Asia/Kolkata";

const STAFF: { key: string; name: string; email: string }[] = [
  { key: "manager", name: "Priya Sharma", email: "manager" },
  { key: "receptionist", name: "Rahul Verma", email: "reception" },
  { key: "housekeeping", name: "Anita Das", email: "housekeeping1" },
  { key: "housekeeping", name: "Sunil Kumar", email: "housekeeping2" },
  { key: "room_service", name: "Vikram Singh", email: "roomservice" },
  { key: "maintenance", name: "Arjun Mehta", email: "maintenance" },
  { key: "security", name: "Kiran Patil", email: "security" },
];

const { db, close } = scriptDb();
try {
  const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.email, adminEmail));
  if (exists) throw new Error("The admin email already exists. Nothing was changed.");

  // 1. Hotel + owner.
  const created = await createTenantWithOwner(db, {
    ownerName: "Saurav (Admin)",
    email: adminEmail,
    password: adminPassword,
    hotelName: HOTEL,
    legalName: "Grand Stay Hospitality Pvt Ltd",
    country: "IN",
    timezone: TZ,
    currency: "INR",
  });
  if (makePlatformAdmin) {
    await db.update(users).set({ isPlatformAdmin: true }).where(eq(users.id, created.userId));
    await writeAudit(db, {
      tenantId: null,
      actorUserId: created.userId,
      actorType: "system",
      action: "platform.admin_granted",
      entityType: "user",
      entityId: created.userId,
      metadata: { via: "seed-demo" },
    });
  }
  const owner = (await loadTenantContext(db, created.userId, created.tenantId))!;
  const pid = created.propertyId;
  await extendTrial(db, { userId: created.userId, isPlatformAdmin: true }, { tenantId: created.tenantId, days: 90, reason: "Demo hotel" });

  // 2. Structure: 3 floors, 3 room types, 25 rooms (each gets an active QR code).
  const f1 = await createFloor(db, owner, pid, { name: "First floor", sortOrder: 1 });
  const f2 = await createFloor(db, owner, pid, { name: "Second floor", sortOrder: 2 });
  const f3 = await createFloor(db, owner, pid, { name: "Third floor", sortOrder: 3 });
  const std = await createCategory(db, owner, pid, { name: "Standard", capacity: 2, description: "Queen bed, city view" });
  const dlx = await createCategory(db, owner, pid, { name: "Deluxe", capacity: 3, description: "King bed, sofa, balcony" });
  const ste = await createCategory(db, owner, pid, { name: "Suite", capacity: 4, description: "Separate living room" });
  await bulkCreateRooms(db, owner, pid, { floorId: f1.id, categoryId: std.id, start: 101, end: 110 });
  await bulkCreateRooms(db, owner, pid, { floorId: f2.id, categoryId: dlx.id, start: 201, end: 210 });
  await bulkCreateRooms(db, owner, pid, { floorId: f3.id, categoryId: ste.id, start: 301, end: 305 });
  const { items: roomList } = await listRooms(db, owner, pid, { pageSize: "100" } as never);
  const room = Object.fromEntries(roomList.map((r) => [r.roomCode, r.id]));

  // 3. Services: standard + module pack, all shown.
  await createDefaultServices(db, owner, pid);
  await createModuleServices(db, owner, pid);
  const { items: services } = await listServices(db, owner, pid);
  for (const s of services) {
    await updateService(db, owner, pid, s.id, {
      name: s.name,
      description: s.description ?? undefined,
      departmentId: s.departmentId,
      icon: s.icon as never,
      enabled: true,
      maxQuantity: s.maxQuantity,
      options: s.options.join("\n"),
      noteMode: s.noteMode,
      availableFrom: s.availableFrom ?? "",
      availableTo: s.availableTo ?? "",
      ackMessage: s.ackMessage ?? undefined,
      priority: s.priority,
      targetMinutes: s.targetMinutes,
      escalate: s.escalate,
      sortOrder: s.sortOrder,
      kind: s.kind,
      allowRoomCharge: true,
    });
  }
  const svc = Object.fromEntries(services.map((s) => [s.key, s]));

  // 4. Guest portal.
  await updatePortalSettings(db, owner, pid, {
    enabled: true,
    showRoomLabel: true,
    welcomeMessage: "Welcome to Grand Stay! Order food, ask for housekeeping or book a spa treatment right from your phone.",
    accentColor: "#1e3a5f",
    wifiSsid: "GrandStay-Guest",
    wifiPassword: "welcome2026",
    wifiNote: "Free high-speed Wi-Fi in all rooms and the lobby.",
    receptionPhone: "+91 22 4000 1234",
    contactEmail: `frontdesk@${STAFF_DOMAIN}`,
    checkInTime: "14:00",
    checkOutTime: "11:00",
    infoSections: [
      { title: "Breakfast", body: "Served 7:00–10:30 in The Courtyard restaurant, ground floor." },
      { title: "Swimming pool & gym", body: "Rooftop pool 7:00–21:00. Gym open 24 hours with your room key." },
      { title: "Checkout", body: "Checkout is at 11:00. Ask reception for late checkout (subject to availability)." },
    ],
  });

  // 5. Staff for every role (department-scoped roles see only their department).
  const staffHash = await hashPassword(staffPassword);
  for (const s of STAFF) {
    const [u] = await db
      .insert(users)
      .values({ email: `${s.email}@${STAFF_DOMAIN}`, name: s.name, passwordHash: staffHash })
      .returning({ id: users.id });
    const [m] = await db.insert(tenantMemberships).values({ tenantId: created.tenantId, userId: u.id, status: "active" }).returning({ id: tenantMemberships.id });
    const [role] = await db.select({ id: roles.id }).from(roles).where(and(isNull(roles.tenantId), eq(roles.key, s.key)));
    await db.insert(userRoleAssignments).values({
      tenantId: created.tenantId,
      membershipId: m.id,
      roleId: role.id,
      propertyId: s.key === "manager" ? null : pid,
      createdByUserId: created.userId,
    });
  }

  // 6. Demo activity: in-house guests, bookings, requests, a guest bill.
  const today = localDate(new Date(), TZ);
  const stay101 = await checkIn(db, owner, pid, { roomId: room["101"], guestName: "Ananya Iyer", phone: "+91 98200 11111", adults: 2, checkoutDate: addDays(today, 2) });
  await checkIn(db, owner, pid, { roomId: room["201"], guestName: "Rohan & Meera Kapoor", phone: "+91 98200 22222", adults: 2, checkoutDate: addDays(today, 3) });
  await checkIn(db, owner, pid, { roomId: room["301"], guestName: "Sameer Joshi", adults: 3, checkoutDate: addDays(today, 1) });
  await createReservation(db, owner, pid, { categoryId: dlx.id, guestName: "Neha Gupta", phone: "+91 98200 33333", arrivalDate: today, departureDate: addDays(today, 2), adults: 2, source: "phone" });
  await createReservation(db, owner, pid, { categoryId: std.id, roomId: room["105"], guestName: "David Fernandes", arrivalDate: addDays(today, 1), departureDate: addDays(today, 4), adults: 1, source: "direct" });
  await createReservation(db, owner, pid, { categoryId: ste.id, guestName: "Kavya Reddy", arrivalDate: addDays(today, 3), departureDate: addDays(today, 6), adults: 4, source: "ota", externalRef: "OTA-DEMO-1001" });
  await createReservation(db, owner, pid, { categoryId: dlx.id, guestName: "Imran Khan", arrivalDate: addDays(today, 5), departureDate: addDays(today, 7), adults: 2, source: "email" });

  const qr = async (code: string) => (await getRoomQr(db, owner, pid, room[code])).active!.url.split("/r/")[1]!;
  const ask = async (code: string, input: Record<string, unknown>) => {
    const res = await submitGuestRequest(db, await qr(code), { idempotencyKey: crypto.randomUUID(), ...input } as never, { ip: null });
    if (res.kind !== "ok") throw new Error(`demo request failed: ${res.kind}`);
    return res.requestId;
  };
  const { items: menu } = await listMenu(db, owner, pid, svc.dining.id);
  const dish = Object.fromEntries(menu.map((m) => [m.name, m.id]));
  const order = await ask("101", { serviceId: svc.dining.id, items: { [dish["Masala chai"]]: "2", [dish["Veg thali"]]: "1" }, paymentMethod: "room" });
  for (const a of ["acknowledge", "start", "complete"] as const) await transitionRequest(db, owner, order, a);
  await addCharge(db, owner, pid, stay101.id, { description: "Minibar", amount: "250" });
  await ask("201", { serviceId: svc.water.id, quantity: "2", note: "Cold water please" });
  const ac = await ask("201", { serviceId: svc.maintenance.id, option: "Air conditioning", note: "AC is not cooling" });
  await transitionRequest(db, owner, ac, "acknowledge");
  await transitionRequest(db, owner, ac, "start");
  await ask("301", { serviceId: svc.housekeeping.id, option: "Extra towels" });

  console.log(
    JSON.stringify({
      hotel: HOTEL,
      tenantId: created.tenantId,
      platformAdmin: makePlatformAdmin,
      rooms: roomList.length,
      services: services.length,
      staff: STAFF.map((s) => `${s.email}@${STAFF_DOMAIN} (${s.key})`),
    }),
  );
} finally {
  await close();
}
