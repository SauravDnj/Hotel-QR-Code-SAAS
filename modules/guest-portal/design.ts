import { and, asc, count, eq, isNull, max, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/types";
import { guestPortalSettings, mediaAssets, properties, serviceItems } from "@/lib/db/schema";
import { AppError, conflict, notFound } from "@/lib/errors";
import { sniffImage } from "@/lib/media/image";
import type { TenantContext } from "@/lib/permissions/authorize";
import { writeAudit } from "@/modules/audit/service";
import { requireProperty } from "@/modules/properties/access";
import { listGuestServices } from "@/modules/services/catalog";
import type { GuestPortal } from "./public";

/**
 * Guest page design (theme template, colours, font) and hotel photos (logo, cover, gallery,
 * service tiles). Photos are hotel pictures only and are served publicly from /media/{id}.
 */

export const THEMES = ["classic", "photo", "elegant", "minimal"] as const;
export type Theme = (typeof THEMES)[number];
export const FONT_STYLES = ["sans", "serif"] as const;
export type FontStyle = (typeof FONT_STYLES)[number];

export const MAX_IMAGE_BYTES = 1_500_000;
export const MAX_GALLERY_PHOTOS = 20;
export const mediaUrl = (id: string) => `/media/${id}`;

const hex = z
  .string()
  .trim()
  .regex(/^$|^#[0-9a-fA-F]{6}$/, "Use a hex colour like #1E3A5F")
  .optional()
  .transform((v) => (v ? v.toLowerCase() : null));

export const designSchema = z.object({
  theme: z.enum(THEMES, "Choose a template"),
  accentColor: hex,
  backgroundColor: hex,
  fontStyle: z.enum(FONT_STYLES).default("sans"),
  showGallery: z
    .union([z.literal("on"), z.literal("true"), z.literal(""), z.boolean()])
    .optional()
    .transform((v) => v === true || v === "on" || v === "true"),
});
export type DesignInput = z.input<typeof designSchema>;

export async function updatePortalDesign(db: Db, ctx: TenantContext, propertyId: string, raw: DesignInput) {
  const property = await requireProperty(db, ctx, propertyId, "property.manage", { write: true });
  const input = designSchema.parse(raw);
  await db.transaction(async (tx) => {
    await tx
      .insert(guestPortalSettings)
      .values({ ...input, propertyId: property.id, tenantId: ctx.tenantId, updatedByUserId: ctx.userId })
      .onConflictDoUpdate({
        target: guestPortalSettings.propertyId,
        set: { ...input, updatedByUserId: ctx.userId },
        setWhere: eq(guestPortalSettings.tenantId, ctx.tenantId),
      });
    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      actorType: "user",
      action: "guest_portal.design_updated",
      entityType: "property",
      entityId: property.id,
      metadata: { theme: input.theme, fontStyle: input.fontStyle },
    });
  });
}

// ---------------------------------------------------------------- photos

function checkImage(bytes: Buffer) {
  if (bytes.length === 0) throw new AppError("Choose a photo", "validation");
  if (bytes.length > MAX_IMAGE_BYTES) throw new AppError("Photo is too large (max 1.5 MB after resizing)", "validation");
  const info = sniffImage(bytes);
  if (!info) throw new AppError("Use a JPEG, PNG or WebP photo", "validation");
  return info;
}

const captionSchema = z.string().trim().max(120, "Caption is too long").optional().transform((v) => v || null);

async function insertAsset(
  tx: Db,
  ctx: TenantContext,
  propertyId: string,
  kind: "logo" | "cover" | "gallery" | "service",
  bytes: Buffer,
  extra: { caption?: string | null; sortOrder?: number } = {},
) {
  const info = checkImage(bytes);
  const [row] = await tx
    .insert(mediaAssets)
    .values({
      tenantId: ctx.tenantId,
      propertyId,
      kind,
      contentType: info.type,
      data: bytes,
      byteSize: bytes.length,
      width: info.width,
      height: info.height,
      caption: extra.caption ?? null,
      sortOrder: extra.sortOrder ?? 0,
      createdByUserId: ctx.userId,
    })
    .returning({ id: mediaAssets.id });
  return row.id;
}

async function deleteAsset(tx: Db, ctx: TenantContext, propertyId: string, id: string | null | undefined) {
  if (!id) return;
  await tx
    .delete(mediaAssets)
    .where(and(eq(mediaAssets.id, id), eq(mediaAssets.tenantId, ctx.tenantId), eq(mediaAssets.propertyId, propertyId)));
}

function audit(tx: Db, ctx: TenantContext, propertyId: string, action: string, metadata: Record<string, unknown>) {
  return writeAudit(tx, {
    tenantId: ctx.tenantId,
    actorUserId: ctx.userId,
    actorType: "user",
    action,
    entityType: "property",
    entityId: propertyId,
    metadata,
  });
}

/** Sets (or replaces) the logo or cover photo. The previous upload is deleted. */
export async function setBrandImage(db: Db, ctx: TenantContext, propertyId: string, kind: "logo" | "cover", bytes: Buffer) {
  const property = await requireProperty(db, ctx, propertyId, "property.manage", { write: true });
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ logo: guestPortalSettings.logoMediaId, cover: guestPortalSettings.coverMediaId })
      .from(guestPortalSettings)
      .where(and(eq(guestPortalSettings.propertyId, property.id), eq(guestPortalSettings.tenantId, ctx.tenantId)));
    const id = await insertAsset(tx, ctx, property.id, kind, bytes);
    const set = kind === "logo" ? { logoMediaId: id } : { coverMediaId: id };
    await tx
      .insert(guestPortalSettings)
      .values({ ...set, propertyId: property.id, tenantId: ctx.tenantId, updatedByUserId: ctx.userId })
      .onConflictDoUpdate({ target: guestPortalSettings.propertyId, set, setWhere: eq(guestPortalSettings.tenantId, ctx.tenantId) });
    await deleteAsset(tx, ctx, property.id, kind === "logo" ? current?.logo : current?.cover);
    await audit(tx, ctx, property.id, "guest_portal.photo_set", { kind });
    return id;
  });
}

export async function removeBrandImage(db: Db, ctx: TenantContext, propertyId: string, kind: "logo" | "cover") {
  const property = await requireProperty(db, ctx, propertyId, "property.manage", { write: true });
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ logo: guestPortalSettings.logoMediaId, cover: guestPortalSettings.coverMediaId })
      .from(guestPortalSettings)
      .where(and(eq(guestPortalSettings.propertyId, property.id), eq(guestPortalSettings.tenantId, ctx.tenantId)));
    // The FK sets the settings column to null.
    await deleteAsset(tx, ctx, property.id, kind === "logo" ? current?.logo : current?.cover);
    await audit(tx, ctx, property.id, "guest_portal.photo_removed", { kind });
  });
}

export async function addGalleryPhoto(db: Db, ctx: TenantContext, propertyId: string, bytes: Buffer, rawCaption?: string) {
  const property = await requireProperty(db, ctx, propertyId, "property.manage", { write: true });
  const caption = captionSchema.parse(rawCaption);
  return db.transaction(async (tx) => {
    // Serialise concurrent uploads for this property so the limit holds.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`gallery:${property.id}`}))`);
    const [stats] = await tx
      .select({ n: count(), last: max(mediaAssets.sortOrder) })
      .from(mediaAssets)
      .where(and(eq(mediaAssets.tenantId, ctx.tenantId), eq(mediaAssets.propertyId, property.id), eq(mediaAssets.kind, "gallery")));
    if (stats.n >= MAX_GALLERY_PHOTOS) throw conflict(`A gallery can hold up to ${MAX_GALLERY_PHOTOS} photos. Remove one first.`);
    const id = await insertAsset(tx, ctx, property.id, "gallery", bytes, { caption, sortOrder: (stats.last ?? 0) + 1 });
    await audit(tx, ctx, property.id, "guest_portal.photo_added", { kind: "gallery" });
    return id;
  });
}

async function galleryPhoto(tx: Db, ctx: TenantContext, propertyId: string, mediaId: string) {
  if (!z.uuid().safeParse(mediaId).success) throw notFound("Photo not found.");
  const [row] = await tx
    .select({ id: mediaAssets.id, sortOrder: mediaAssets.sortOrder })
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.id, mediaId),
        eq(mediaAssets.tenantId, ctx.tenantId),
        eq(mediaAssets.propertyId, propertyId),
        eq(mediaAssets.kind, "gallery"),
      ),
    );
  if (!row) throw notFound("Photo not found.");
  return row;
}

export async function updateGalleryPhoto(
  db: Db,
  ctx: TenantContext,
  propertyId: string,
  mediaId: string,
  raw: { caption?: string; move?: "up" | "down" },
) {
  const property = await requireProperty(db, ctx, propertyId, "property.manage", { write: true });
  await db.transaction(async (tx) => {
    const photo = await galleryPhoto(tx, ctx, property.id, mediaId);
    if (raw.caption !== undefined) {
      await tx.update(mediaAssets).set({ caption: captionSchema.parse(raw.caption) }).where(eq(mediaAssets.id, photo.id));
    }
    if (raw.move) {
      const list = await tx
        .select({ id: mediaAssets.id, sortOrder: mediaAssets.sortOrder })
        .from(mediaAssets)
        .where(and(eq(mediaAssets.tenantId, ctx.tenantId), eq(mediaAssets.propertyId, property.id), eq(mediaAssets.kind, "gallery")))
        .orderBy(asc(mediaAssets.sortOrder), asc(mediaAssets.createdAt));
      const i = list.findIndex((p) => p.id === photo.id);
      const j = raw.move === "up" ? i - 1 : i + 1;
      if (j >= 0 && j < list.length) {
        [list[i], list[j]] = [list[j], list[i]];
        for (const [k, p] of list.entries()) await tx.update(mediaAssets).set({ sortOrder: k + 1 }).where(eq(mediaAssets.id, p.id));
      }
    }
  });
}

export async function removeGalleryPhoto(db: Db, ctx: TenantContext, propertyId: string, mediaId: string) {
  const property = await requireProperty(db, ctx, propertyId, "property.manage", { write: true });
  await db.transaction(async (tx) => {
    const photo = await galleryPhoto(tx, ctx, property.id, mediaId);
    await deleteAsset(tx, ctx, property.id, photo.id);
    await audit(tx, ctx, property.id, "guest_portal.photo_removed", { kind: "gallery" });
  });
}

/** Photo on a service tile; null removes it. */
export async function setServiceImage(db: Db, ctx: TenantContext, propertyId: string, serviceId: string, bytes: Buffer | null) {
  const property = await requireProperty(db, ctx, propertyId, "service.manage", { write: true });
  if (!z.uuid().safeParse(serviceId).success) throw notFound("Service not found.");
  await db.transaction(async (tx) => {
    const [svc] = await tx
      .select({ id: serviceItems.id, imageMediaId: serviceItems.imageMediaId })
      .from(serviceItems)
      .where(and(eq(serviceItems.id, serviceId), eq(serviceItems.tenantId, ctx.tenantId), eq(serviceItems.propertyId, property.id)))
      .for("update");
    if (!svc) throw notFound("Service not found.");
    const id = bytes ? await insertAsset(tx, ctx, property.id, "service", bytes) : null;
    await tx.update(serviceItems).set({ imageMediaId: id }).where(eq(serviceItems.id, svc.id));
    await deleteAsset(tx, ctx, property.id, svc.imageMediaId);
    await audit(tx, ctx, property.id, bytes ? "service.photo_set" : "service.photo_removed", { serviceId: svc.id });
  });
}

/** Admin view of a property's photos (no image bytes). */
export async function listPortalMedia(db: Db, ctx: TenantContext, propertyId: string) {
  const property = await requireProperty(db, ctx, propertyId, "property.view");
  const [settings] = await db
    .select({ logo: guestPortalSettings.logoMediaId, cover: guestPortalSettings.coverMediaId })
    .from(guestPortalSettings)
    .where(and(eq(guestPortalSettings.propertyId, property.id), eq(guestPortalSettings.tenantId, ctx.tenantId)));
  const gallery = await db
    .select({ id: mediaAssets.id, caption: mediaAssets.caption, byteSize: mediaAssets.byteSize })
    .from(mediaAssets)
    .where(and(eq(mediaAssets.tenantId, ctx.tenantId), eq(mediaAssets.propertyId, property.id), eq(mediaAssets.kind, "gallery")))
    .orderBy(asc(mediaAssets.sortOrder), asc(mediaAssets.createdAt));
  const services = await db
    .select({ id: serviceItems.id, name: serviceItems.name, icon: serviceItems.icon, imageMediaId: serviceItems.imageMediaId, enabled: serviceItems.enabled })
    .from(serviceItems)
    .where(and(eq(serviceItems.tenantId, ctx.tenantId), eq(serviceItems.propertyId, property.id), isNull(serviceItems.archivedAt)))
    .orderBy(asc(serviceItems.sortOrder), asc(serviceItems.name));
  return {
    property,
    logoUrl: settings?.logo ? mediaUrl(settings.logo) : null,
    coverUrl: settings?.cover ? mediaUrl(settings.cover) : null,
    gallery: gallery.map((g) => ({ ...g, url: mediaUrl(g.id) })),
    services: services.map((s) => ({ ...s, imageUrl: s.imageMediaId ? mediaUrl(s.imageMediaId) : null })),
  };
}

/** Public image bytes for /media/{id}. */
export async function getPublicMedia(db: Db, id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const [row] = await db
    .select({ contentType: mediaAssets.contentType, data: mediaAssets.data })
    .from(mediaAssets)
    .where(eq(mediaAssets.id, id));
  return row ?? null;
}

/** Public gallery for the guest page. */
export async function publicGallery(db: Db, scope: { tenantId: string; propertyId: string }) {
  const rows = await db
    .select({ id: mediaAssets.id, caption: mediaAssets.caption })
    .from(mediaAssets)
    .where(and(eq(mediaAssets.tenantId, scope.tenantId), eq(mediaAssets.propertyId, scope.propertyId), eq(mediaAssets.kind, "gallery")))
    .orderBy(asc(mediaAssets.sortOrder), asc(mediaAssets.createdAt))
    .limit(MAX_GALLERY_PHOTOS);
  return rows.map((r) => ({ url: mediaUrl(r.id), caption: r.caption }));
}



/** What a guest would see (for the admin live preview). The Wi-Fi password is masked. */
export async function previewPortal(db: Db, ctx: TenantContext, propertyId: string) {
  const property = await requireProperty(db, ctx, propertyId, "property.view");
  const [[p], [cfgRow], services, gallery] = await Promise.all([
    db.select({ name: properties.name, city: properties.city }).from(properties).where(and(eq(properties.id, property.id), eq(properties.tenantId, ctx.tenantId))),
    db.select().from(guestPortalSettings).where(and(eq(guestPortalSettings.propertyId, property.id), eq(guestPortalSettings.tenantId, ctx.tenantId))),
    listGuestServices(db, { tenantId: ctx.tenantId, propertyId: property.id, timezone: property.timezone }),
    publicGallery(db, { tenantId: ctx.tenantId, propertyId: property.id }),
  ]);
  const cfg = cfgRow ?? null;
  const portal: GuestPortal = {
    hotelName: p.name,
    city: p.city,
    roomLabel: cfg?.showRoomLabel === false ? null : "101",
    welcomeMessage: cfg?.welcomeMessage ?? null,
    accentColor: cfg?.accentColor ?? null,
    logoUrl: cfg?.logoMediaId ? mediaUrl(cfg.logoMediaId) : (cfg?.logoUrl ?? null),
    coverImageUrl: cfg?.coverMediaId ? mediaUrl(cfg.coverMediaId) : (cfg?.coverImageUrl ?? null),
    theme: (THEMES as readonly string[]).includes(cfg?.theme ?? "") ? (cfg!.theme as Theme) : "classic",
    backgroundColor: cfg?.backgroundColor ?? null,
    fontStyle: cfg?.fontStyle === "serif" ? "serif" : "sans",
    gallery,
    wifi: cfg?.wifiSsid ? { ssid: cfg.wifiSsid, password: cfg.wifiPasswordCiphertext ? "••••••••" : null, note: cfg.wifiNote } : null,
    receptionPhone: cfg?.receptionPhone ?? null,
    contactEmail: cfg?.contactEmail ?? null,
    checkInTime: cfg?.checkInTime ?? null,
    checkOutTime: cfg?.checkOutTime ?? null,
    infoSections: cfg?.infoSections ?? [],
    privacyNotice: cfg?.privacyNotice ?? null,
  };
  return { portal, services, settings: cfg };
}
