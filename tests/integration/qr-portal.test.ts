import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/types";
import { auditLogs, guestPortalSettings, properties, roomQrCodes, tenants } from "@/lib/db/schema";
import { decryptSecret } from "@/lib/crypto/secrets";
import { resolveGuestPortal } from "@/modules/guest-portal/public";
import { getPortalSettings, updatePortalSettings } from "@/modules/guest-portal/settings";
import {
  deactivateRoomQr,
  getRoomQr,
  issueMissingQr,
  issueRoomQr,
  listPropertyQr,
  qrSheet,
  reactivateRoomQr,
  rotateRoomQr,
} from "@/modules/qr/service";
import { createCategory } from "@/modules/rooms/categories";
import { createFloor } from "@/modules/rooms/floors";
import { bulkCreateRooms, createRoom, setRoomArchived } from "@/modules/rooms/rooms";
import { addStaff, createTenantFixture, createTestDb, type TenantFixture } from "../helpers/db";

const tokenOf = (url: string) => url.split("/r/")[1]!;
let ipCounter = 0;
const freshIp = () => `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;
const scan = (db: Db, token: unknown) => resolveGuestPortal(db, token, { ip: freshIp() });

async function hotelWithRoom(db: Db, name: string) {
  const t = await createTenantFixture(db, { hotelName: name });
  const floor = await createFloor(db, t.ctx, t.propertyId, { name: "Floor 1" });
  const cat = await createCategory(db, t.ctx, t.propertyId, { name: "Deluxe", capacity: 2 });
  const room = await createRoom(db, t.ctx, t.propertyId, { roomCode: "101", floorId: floor.id, categoryId: cat.id });
  return { t, floor, cat, room };
}

describe("room QR lifecycle and guest portal", () => {
  let db: Db;
  let A: Awaited<ReturnType<typeof hotelWithRoom>>;
  let B: Awaited<ReturnType<typeof hotelWithRoom>>;

  beforeAll(async () => {
    db = await createTestDb();
    A = await hotelWithRoom(db, "Alpha Hotel");
    B = await hotelWithRoom(db, "Bravo Hotel");
  });

  it("issues a QR automatically when a room is created, storing only hash + ciphertext", async () => {
    const qr = await getRoomQr(db, A.t.ctx, A.t.propertyId, A.room.id);
    expect(qr.active).not.toBeNull();
    const token = tokenOf(qr.active!.url);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(qr.active!.url).not.toContain(A.room.id);
    expect(qr.active!.url).not.toContain(A.t.tenantId);

    const [row] = await db.select().from(roomQrCodes).where(eq(roomQrCodes.roomId, A.room.id));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(decryptSecret(row.tokenCiphertext)).toBe(token);
  });

  it("resolves the token to exactly its own room and hotel", async () => {
    const a = await getRoomQr(db, A.t.ctx, A.t.propertyId, A.room.id);
    const b = await getRoomQr(db, B.t.ctx, B.t.propertyId, B.room.id);
    const ra = await scan(db, tokenOf(a.active!.url));
    const rb = await scan(db, tokenOf(b.active!.url));
    expect(ra).toMatchObject({ kind: "ok", portal: { hotelName: "Alpha Hotel", roomLabel: "101" } });
    expect(rb).toMatchObject({ kind: "ok", portal: { hotelName: "Bravo Hotel", roomLabel: "101" } });
  });

  it("shows a safe 'unavailable' result for unknown or malformed tokens", async () => {
    expect(await scan(db, "A".repeat(43))).toEqual({ kind: "unavailable" });
    expect(await scan(db, "short")).toEqual({ kind: "unavailable" });
    expect(await scan(db, A.room.id)).toEqual({ kind: "unavailable" });
  });

  it("returns only guest-safe fields (no ids, tenant, stays or secrets)", async () => {
    await updatePortalSettings(db, A.t.ctx, A.t.propertyId, {
      wifiSsid: "Alpha-Guest",
      wifiPassword: "sunrise-2026",
      welcomeMessage: "Welcome!",
      showRoomLabel: "on",
      enabled: "on",
    });
    const qr = await getRoomQr(db, A.t.ctx, A.t.propertyId, A.room.id);
    const res = await scan(db, tokenOf(qr.active!.url));
    if (res.kind !== "ok") throw new Error("expected ok");
    expect(Object.keys(res.portal).sort()).toEqual(
      [
        "checkInTime", "checkOutTime", "city", "contactEmail", "coverImageUrl", "hotelName", "infoSections",
        "logoUrl", "privacyNotice", "receptionPhone", "roomLabel", "welcomeMessage", "wifi", "accentColor",
      ].sort(),
    );
    expect(res.portal.wifi).toEqual({ ssid: "Alpha-Guest", password: "sunrise-2026", note: null });
    const json = JSON.stringify(res);
    for (const secret of [A.t.tenantId, A.t.propertyId, A.room.id, A.t.userId, tokenOf(qr.active!.url)]) {
      expect(json).not.toContain(secret);
    }
  });

  it("encrypts the Wi-Fi password at rest and never returns it to the admin UI", async () => {
    const [row] = await db.select().from(guestPortalSettings).where(eq(guestPortalSettings.propertyId, A.t.propertyId));
    expect(row.wifiPasswordCiphertext).not.toContain("sunrise-2026");
    const admin = await getPortalSettings(db, A.t.ctx, A.t.propertyId);
    expect(JSON.stringify(admin)).not.toContain("sunrise-2026");
    expect(JSON.stringify(admin)).not.toContain(row.wifiPasswordCiphertext!);
    expect(admin.settings.hasWifiPassword).toBe(true);

    // Blank password keeps it; clear removes it. Audit records no value.
    await updatePortalSettings(db, A.t.ctx, A.t.propertyId, { wifiSsid: "Alpha-Guest", enabled: "on", showRoomLabel: "on" });
    expect((await getPortalSettings(db, A.t.ctx, A.t.propertyId)).settings.hasWifiPassword).toBe(true);
    const audits = await db.select().from(auditLogs).where(eq(auditLogs.action, "guest_portal.updated"));
    expect(JSON.stringify(audits)).not.toContain("sunrise-2026");
  });

  it("can hide the room label and disable the portal", async () => {
    const token = tokenOf((await getRoomQr(db, A.t.ctx, A.t.propertyId, A.room.id)).active!.url);
    await updatePortalSettings(db, A.t.ctx, A.t.propertyId, { enabled: "on" });
    expect(await scan(db, token)).toMatchObject({ kind: "ok", portal: { roomLabel: null } });
    await updatePortalSettings(db, A.t.ctx, A.t.propertyId, { enabled: "" });
    expect(await scan(db, token)).toEqual({ kind: "unavailable" });
    await updatePortalSettings(db, A.t.ctx, A.t.propertyId, { enabled: "on", showRoomLabel: "on" });
    expect(await scan(db, token)).toMatchObject({ kind: "ok" });
  });

  it("rotation kills the old printed code immediately and it can never be reactivated", async () => {
    const before = await getRoomQr(db, A.t.ctx, A.t.propertyId, A.room.id);
    const oldToken = tokenOf(before.active!.url);
    await rotateRoomQr(db, A.t.ctx, A.t.propertyId, A.room.id);
    const after = await getRoomQr(db, A.t.ctx, A.t.propertyId, A.room.id);
    expect(after.active!.url).not.toBe(before.active!.url);
    expect(await scan(db, oldToken)).toEqual({ kind: "unavailable" });
    expect(await scan(db, tokenOf(after.active!.url))).toMatchObject({ kind: "ok" });
    expect(after.history.filter((h) => h.status === "revoked")[0]).toMatchObject({ revokeReason: "rotated" });

    await deactivateRoomQr(db, A.t.ctx, A.t.propertyId, A.room.id);
    await expect(reactivateRoomQr(db, A.t.ctx, A.t.propertyId, A.room.id, before.active!.id)).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("deactivate/reactivate keeps the same sticker working afterwards", async () => {
    const qr = await getRoomQr(db, A.t.ctx, A.t.propertyId, A.room.id); // currently deactivated
    expect(qr.active).toBeNull();
    const deactivated = qr.history.find((h) => h.revokeReason === "deactivated")!;
    const [row] = await db.select().from(roomQrCodes).where(eq(roomQrCodes.id, deactivated.id));
    const token = decryptSecret(row.tokenCiphertext);
    expect(await scan(db, token)).toEqual({ kind: "unavailable" });

    await reactivateRoomQr(db, A.t.ctx, A.t.propertyId, A.room.id, deactivated.id);
    expect(await scan(db, token)).toMatchObject({ kind: "ok" });
    await expect(issueRoomQr(db, A.t.ctx, A.t.propertyId, A.room.id)).rejects.toMatchObject({ code: "conflict" });
  });

  it("counts scans", async () => {
    const qr = await getRoomQr(db, A.t.ctx, A.t.propertyId, A.room.id);
    await scan(db, tokenOf(qr.active!.url));
    const again = await getRoomQr(db, A.t.ctx, A.t.propertyId, A.room.id);
    expect(again.active!.scanCount).toBe(qr.active!.scanCount + 1);
    expect(again.active!.lastScannedAt).not.toBeNull();
  });

  it("stops resolving for archived rooms, inactive properties and suspended tenants", async () => {
    const token = tokenOf((await getRoomQr(db, B.t.ctx, B.t.propertyId, B.room.id)).active!.url);
    await setRoomArchived(db, B.t.ctx, B.t.propertyId, B.room.id, true);
    expect(await scan(db, token)).toEqual({ kind: "unavailable" });
    await setRoomArchived(db, B.t.ctx, B.t.propertyId, B.room.id, false);
    expect(await scan(db, token)).toMatchObject({ kind: "ok" });

    await db.update(properties).set({ status: "inactive" }).where(eq(properties.id, B.t.propertyId));
    expect(await scan(db, token)).toEqual({ kind: "unavailable" });
    await db.update(properties).set({ status: "active" }).where(eq(properties.id, B.t.propertyId));

    await db.update(tenants).set({ status: "suspended" }).where(eq(tenants.id, B.t.tenantId));
    expect(await scan(db, token)).toEqual({ kind: "unavailable" });
    await db.update(tenants).set({ status: "trialing" }).where(eq(tenants.id, B.t.tenantId));
    expect(await scan(db, token)).toMatchObject({ kind: "ok" });
  });

  it("rate-limits scans per network, including invalid guesses", async () => {
    const ip = "203.0.113.9";
    let last;
    for (let i = 0; i < 121; i++) last = await resolveGuestPortal(db, "B".repeat(43), { ip });
    expect(last).toEqual({ kind: "rate_limited" });
  });

  it("does not let another tenant read or change this hotel's QR codes", async () => {
    const B_ctx = B.t.ctx;
    await expect(getRoomQr(db, B_ctx, A.t.propertyId, A.room.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(rotateRoomQr(db, B_ctx, A.t.propertyId, A.room.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(qrSheet(db, B_ctx, A.t.propertyId)).rejects.toMatchObject({ code: "not_found" });
    await expect(updatePortalSettings(db, B_ctx, A.t.propertyId, { wifiSsid: "pwned" })).rejects.toMatchObject({
      code: "not_found",
    });
    // B's own room id under B's property with A's room id: not found.
    await expect(getRoomQr(db, B_ctx, B.t.propertyId, A.room.id)).rejects.toMatchObject({ code: "not_found" });
  });

  it("lets receptionists view and print codes but not change them", async () => {
    const reception = await addStaff(db, A.t as TenantFixture, "receptionist", null);
    await expect(getRoomQr(db, reception, A.t.propertyId, A.room.id)).resolves.toBeDefined();
    await expect(qrSheet(db, reception, A.t.propertyId)).resolves.toBeDefined();
    await expect(rotateRoomQr(db, reception, A.t.propertyId, A.room.id)).rejects.toMatchObject({ code: "forbidden" });
    await expect(deactivateRoomQr(db, reception, A.t.propertyId, A.room.id)).rejects.toMatchObject({ code: "forbidden" });
    await expect(updatePortalSettings(db, reception, A.t.propertyId, { wifiSsid: "x" })).rejects.toMatchObject({
      code: "forbidden",
    });
    const hk = await addStaff(db, A.t as TenantFixture, "housekeeping", null);
    await expect(getRoomQr(db, hk, A.t.propertyId, A.room.id)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("bulk-issues missing codes and prints sheets by floor", async () => {
    await bulkCreateRooms(db, A.t.ctx, A.t.propertyId, { floorId: A.floor.id, categoryId: A.cat.id, start: 201, end: 205 });
    const floor2 = await createFloor(db, A.t.ctx, A.t.propertyId, { name: "Floor 2" });
    await createRoom(db, A.t.ctx, A.t.propertyId, { roomCode: "301", floorId: floor2.id, categoryId: A.cat.id });
    // Simulate rooms created before Phase 3 (no codes yet).
    await db.delete(roomQrCodes).where(eq(roomQrCodes.propertyId, A.t.propertyId));
    expect((await issueMissingQr(db, A.t.ctx, A.t.propertyId)).count).toBe(7);
    expect((await issueMissingQr(db, A.t.ctx, A.t.propertyId)).count).toBe(0);

    const { items } = await listPropertyQr(db, A.t.ctx, A.t.propertyId);
    expect(items.every((i) => i.qrId)).toBe(true);
    const sheet = await qrSheet(db, A.t.ctx, A.t.propertyId, { floorId: floor2.id });
    expect(sheet.items.map((i) => i.roomCode)).toEqual(["301"]);
    const all = await qrSheet(db, A.t.ctx, A.t.propertyId);
    expect(all.items.map((i) => i.roomCode)).toEqual(["101", "201", "202", "203", "204", "205", "301"]);
    expect(new Set(all.items.map((i) => i.url)).size).toBe(7);
  });

  it("audits QR changes without storing tokens", async () => {
    const rows = await db.select().from(auditLogs).where(eq(auditLogs.tenantId, A.t.tenantId));
    const actions = rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["qr.rotated", "qr.deactivated", "qr.reactivated", "qr.bulk_issued"]));
    const tokens = (await db.select().from(roomQrCodes)).map((r) => decryptSecret(r.tokenCiphertext));
    const blob = JSON.stringify(rows);
    for (const t of tokens) expect(blob).not.toContain(t);
  });
});
