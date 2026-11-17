import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/types";
import { guestPortalSettings, mediaAssets, reservations, serviceItems } from "@/lib/db/schema";
import { sniffImage } from "@/lib/media/image";
import type { TenantContext } from "@/lib/permissions/authorize";
import { addDays, localDate } from "@/lib/timezones";
import {
  addGalleryPhoto,
  getPublicMedia,
  listPortalMedia,
  MAX_GALLERY_PHOTOS,
  previewPortal,
  removeBrandImage,
  removeGalleryPhoto,
  setBrandImage,
  setServiceImage,
  updateGalleryPhoto,
  updatePortalDesign,
} from "@/modules/guest-portal/design";
import { resolveGuestPortal } from "@/modules/guest-portal/public";
import { updatePortalSettings } from "@/modules/guest-portal/settings";
import { getRoomQr } from "@/modules/qr/service";
import { createReservation, sweepNoShows } from "@/modules/reservations/service";
import { createCategory } from "@/modules/rooms/categories";
import { createFloor } from "@/modules/rooms/floors";
import { createRoom } from "@/modules/rooms/rooms";
import { createDefaultServices, listServices } from "@/modules/services/catalog";
import { loadSupportContext } from "@/modules/tenants/context";
import { addStaff, createTenantFixture, createTestDb, type TenantFixture } from "../helpers/db";

// Minimal valid headers for each accepted format.
function png(w = 64, h = 32) {
  const b = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).copy(b, 0);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}
function jpeg(w = 800, h = 600) {
  const b = Buffer.alloc(64);
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).copy(b, 0); // SOI + APP0 (len 16)
  const sof = 2 + 2 + 16; // after APP0 segment
  Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08]).copy(b, sof);
  b.writeUInt16BE(h, sof + 5);
  b.writeUInt16BE(w, sof + 7);
  return b;
}
function webp(w = 1200, h = 900) {
  const b = Buffer.alloc(40);
  b.write("RIFF", 0, "latin1");
  b.write("WEBP", 8, "latin1");
  b.write("VP8X", 12, "latin1");
  b.writeUIntLE(w - 1, 24, 3);
  b.writeUIntLE(h - 1, 27, 3);
  return b;
}

describe("guest page design, photos and automatic no-shows", () => {
  let db: Db;
  let A: TenantFixture;
  let B: TenantFixture;
  let token: string;
  let housekeeper: TenantContext;

  beforeAll(async () => {
    db = await createTestDb();
    A = await createTenantFixture(db, { hotelName: "Design Hotel" });
    B = await createTenantFixture(db, { hotelName: "Other Hotel" });
    const floor = await createFloor(db, A.ctx, A.propertyId, { name: "F1" });
    const cat = await createCategory(db, A.ctx, A.propertyId, { name: "Deluxe", capacity: 2 });
    const room = await createRoom(db, A.ctx, A.propertyId, { roomCode: "101", floorId: floor.id, categoryId: cat.id });
    token = (await getRoomQr(db, A.ctx, A.propertyId, room.id)).active!.url.split("/r/")[1]!;
    await createDefaultServices(db, A.ctx, A.propertyId);
    housekeeper = await addStaff(db, A, "housekeeping", A.propertyId);
  });

  it("recognises images by their bytes, never by name, and refuses everything else", () => {
    expect(sniffImage(png())).toEqual({ type: "image/png", width: 64, height: 32 });
    expect(sniffImage(jpeg())).toEqual({ type: "image/jpeg", width: 800, height: 600 });
    expect(sniffImage(webp())).toEqual({ type: "image/webp", width: 1200, height: 900 });
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(sniffImage(Buffer.from("<html><body>hi</body></html>"))).toBeNull();
  });

  it("saves the design and the guest page uses it", async () => {
    await updatePortalDesign(db, A.ctx, A.propertyId, {
      theme: "elegant",
      accentColor: "#7F1D1D",
      backgroundColor: "#fdf6f0",
      fontStyle: "serif",
      showGallery: "on",
    });
    const res = await resolveGuestPortal(db, token, { ip: null });
    if (res.kind !== "ok") throw new Error("expected ok");
    expect(res.portal).toMatchObject({ theme: "elegant", accentColor: "#7f1d1d", backgroundColor: "#fdf6f0", fontStyle: "serif" });
    await expect(updatePortalDesign(db, A.ctx, A.propertyId, { theme: "neon" as never })).rejects.toThrow();
    await expect(updatePortalDesign(db, A.ctx, A.propertyId, { theme: "classic", accentColor: "red;x" })).rejects.toThrow();
  });

  it("keeps the design when the Guest portal form (without colours) is saved", async () => {
    await updatePortalSettings(db, A.ctx, A.propertyId, { enabled: "on", showRoomLabel: "on", wifiSsid: "Design-Guest" });
    const [row] = await db.select().from(guestPortalSettings).where(eq(guestPortalSettings.propertyId, A.propertyId));
    expect(row).toMatchObject({ accentColor: "#7f1d1d", theme: "elegant", wifiSsid: "Design-Guest" });
  });

  it("uploads logo, cover, gallery and service photos; serves them publicly; replaces old files", async () => {
    const logo1 = await setBrandImage(db, A.ctx, A.propertyId, "logo", png());
    const logo2 = await setBrandImage(db, A.ctx, A.propertyId, "logo", png(128, 128));
    expect(await getPublicMedia(db, logo1)).toBeNull(); // old logo deleted
    expect((await getPublicMedia(db, logo2))?.contentType).toBe("image/png");
    await setBrandImage(db, A.ctx, A.propertyId, "cover", jpeg());
    const g1 = await addGalleryPhoto(db, A.ctx, A.propertyId, webp(), "Rooftop pool");
    const g2 = await addGalleryPhoto(db, A.ctx, A.propertyId, jpeg(), "");
    const svc = (await listServices(db, A.ctx, A.propertyId)).items[0];
    await setServiceImage(db, A.ctx, A.propertyId, svc.id, jpeg());

    const res = await resolveGuestPortal(db, token, { ip: null });
    if (res.kind !== "ok") throw new Error("expected ok");
    expect(res.portal.logoUrl).toBe(`/media/${logo2}`);
    expect(res.portal.coverImageUrl).toMatch(/^\/media\//);
    expect(res.portal.gallery).toEqual([
      { url: `/media/${g1}`, caption: "Rooftop pool" },
      { url: `/media/${g2}`, caption: null },
    ]);
    // Service tiles only carry the public URL, never the media id field.
    const tile = res.services.find((s) => s.id === svc.id)!;
    expect(tile.imageUrl).toMatch(/^\/media\//);
    expect(Object.keys(tile)).not.toContain("imageMediaId");

    await updateGalleryPhoto(db, A.ctx, A.propertyId, g2, { move: "up", caption: "Lobby" });
    expect((await listPortalMedia(db, A.ctx, A.propertyId)).gallery.map((g) => [g.id, g.caption])).toEqual([
      [g2, "Lobby"],
      [g1, "Rooftop pool"],
    ]);

    await updatePortalDesign(db, A.ctx, A.propertyId, { theme: "photo", showGallery: "" });
    const hidden = await resolveGuestPortal(db, token, { ip: null });
    if (hidden.kind !== "ok") throw new Error("expected ok");
    expect(hidden.portal.gallery).toEqual([]);

    await removeGalleryPhoto(db, A.ctx, A.propertyId, g1);
    await removeBrandImage(db, A.ctx, A.propertyId, "cover");
    const after = await listPortalMedia(db, A.ctx, A.propertyId);
    expect(after.gallery).toHaveLength(1);
    expect(after.coverUrl).toBeNull();
    await setServiceImage(db, A.ctx, A.propertyId, svc.id, null);
    expect((await db.select().from(serviceItems).where(eq(serviceItems.id, svc.id)))[0].imageMediaId).toBeNull();
  });

  it("rejects bad files, oversized files and a full gallery", async () => {
    await expect(addGalleryPhoto(db, A.ctx, A.propertyId, Buffer.from("<svg onload=alert(1)>"))).rejects.toMatchObject({ code: "validation" });
    await expect(addGalleryPhoto(db, A.ctx, A.propertyId, Buffer.alloc(0))).rejects.toMatchObject({ code: "validation" });
    const big = Buffer.concat([jpeg(), Buffer.alloc(1_600_000)]);
    await expect(addGalleryPhoto(db, A.ctx, A.propertyId, big)).rejects.toMatchObject({ code: "validation" });
    const have = (await listPortalMedia(db, A.ctx, A.propertyId)).gallery.length;
    for (let i = have; i < MAX_GALLERY_PHOTOS; i++) await addGalleryPhoto(db, A.ctx, A.propertyId, png());
    await expect(addGalleryPhoto(db, A.ctx, A.propertyId, png())).rejects.toMatchObject({ code: "conflict" });
  });

  it("enforces permissions, tenant isolation and read-only support view", async () => {
    await expect(setBrandImage(db, housekeeper, A.propertyId, "logo", png())).rejects.toMatchObject({ code: "forbidden" });
    await expect(updatePortalDesign(db, housekeeper, A.propertyId, { theme: "minimal" })).rejects.toMatchObject({ code: "forbidden" });
    // Another hotel cannot touch this property or its photos.
    await expect(setBrandImage(db, B.ctx, A.propertyId, "logo", png())).rejects.toMatchObject({ code: "not_found" });
    const photo = (await listPortalMedia(db, A.ctx, A.propertyId)).gallery[0];
    await expect(removeGalleryPhoto(db, B.ctx, B.propertyId, photo.id)).rejects.toMatchObject({ code: "not_found" });
    const support = (await loadSupportContext(db, B.userId, A.tenantId))!;
    await expect(addGalleryPhoto(db, support, A.propertyId, png())).rejects.toMatchObject({ code: "forbidden" });
    expect((await previewPortal(db, support, A.propertyId)).portal.hotelName).toBe("Design Hotel");
    // The media table rows all belong to A.
    const rows = await db.select({ t: mediaAssets.tenantId }).from(mediaAssets);
    expect(new Set(rows.map((r) => r.t))).toEqual(new Set([A.tenantId]));
  });

  it("night audit marks past, unchecked-in bookings as no-show and leaves future ones", async () => {
    const cat = await createCategory(db, A.ctx, A.propertyId, { name: "Suite", capacity: 4 });
    const floor = await createFloor(db, A.ctx, A.propertyId, { name: "F9" });
    await createRoom(db, A.ctx, A.propertyId, { roomCode: "901", floorId: floor.id, categoryId: cat.id });
    const today = localDate(new Date(), "Asia/Kolkata");
    const book = (arrival: string) =>
      createReservation(db, A.ctx, A.propertyId, {
        categoryId: cat.id,
        guestName: "Late Guest",
        arrivalDate: arrival,
        departureDate: addDays(arrival, 1),
        adults: 1,
      }).then((r) => r.reservation);
    const todayBooking = await book(today);
    const future = await book(addDays(today, 5));

    expect(await sweepNoShows(db, new Date())).toBe(0); // arrival day not over yet
    const twoDaysLater = new Date(Date.now() + 2 * 86400_000);
    expect(await sweepNoShows(db, twoDaysLater)).toBe(1);
    expect(await sweepNoShows(db, twoDaysLater)).toBe(0); // idempotent
    const status = async (id: string) => (await db.select().from(reservations).where(and(eq(reservations.id, id))))[0].status;
    expect(await status(todayBooking.id)).toBe("no_show");
    expect(await status(future.id)).toBe("confirmed");
  });
});
