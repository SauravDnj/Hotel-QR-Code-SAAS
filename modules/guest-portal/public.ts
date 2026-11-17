import { and, eq, isNull, notInArray, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/types";
import { guestPortalSettings, properties, roomQrCodes, rooms, tenants } from "@/lib/db/schema";
import { decryptSecret, hashQrToken, isWellFormedQrToken } from "@/lib/crypto/secrets";
import { errorFields, logger } from "@/lib/observability/logger";
import { consumeRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { listGuestServices } from "@/modules/services/catalog";
import { DEFAULT_PORTAL } from "./settings";

/**
 * Public QR resolution (QR_GUEST_PORTAL.md "Public route resolution").
 *
 * The opaque token is the ONLY input. Tenant, property and room come from the database row
 * the token hash points at; nothing from the client can override them. Scanning a QR does
 * NOT authenticate anyone: the result holds only hotel-level information plus the room
 * label, never guest names, stays, invoices or request history. Callers must not log the
 * token (it is a bearer credential for this page).
 */

export interface GuestPortal {
  hotelName: string;
  city: string | null;
  roomLabel: string | null;
  welcomeMessage: string | null;
  accentColor: string | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
  wifi: { ssid: string; password: string | null; note: string | null } | null;
  receptionPhone: string | null;
  contactEmail: string | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  infoSections: { title: string; body: string }[];
  privacyNotice: string | null;
}

export interface GuestService {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  maxQuantity: number;
  options: string[];
  noteMode: "none" | "optional" | "required";
  availableFrom: string | null;
  availableTo: string | null;
  availableNow: boolean;
}

export type PortalResult = { kind: "ok"; portal: GuestPortal; services: GuestService[] } | { kind: "unavailable" } | { kind: "rate_limited" };

const BLOCKED_TENANT_STATUSES = ["suspended", "cancelled"] as const;

export async function resolveGuestPortal(db: Db, token: unknown, opts: { ip: string | null }): Promise<PortalResult> {
  // Count every attempt, valid or not, so token guessing is throttled per network.
  if (opts.ip) {
    const byIp = await consumeRateLimit(db, `qr-scan:ip:${opts.ip}`, RATE_LIMITS.qrScanByIp);
    if (!byIp.allowed) return { kind: "rate_limited" };
  }
  const row = await findActiveQr(db, token);
  if (!row) return { kind: "unavailable" };
  const s = row.settings;

  const byQr = await consumeRateLimit(db, `qr-scan:qr:${row.qrId}`, RATE_LIMITS.qrScanByCode);
  if (!byQr.allowed) return { kind: "rate_limited" };
  await db
    .update(roomQrCodes)
    .set({ scanCount: sql`${roomQrCodes.scanCount} + 1`, lastScannedAt: new Date() })
    .where(eq(roomQrCodes.id, row.qrId));

  const cfg = s ?? { ...DEFAULT_PORTAL, wifiPasswordCiphertext: null };
  let password: string | null = null;
  if (cfg.wifiPasswordCiphertext) {
    try {
      password = decryptSecret(cfg.wifiPasswordCiphertext);
    } catch (err) {
      logger.error("wifi_password_decrypt_failed", { qrId: row.qrId, ...errorFields(err) });
    }
  }

  // Explicit allow-list of guest-safe fields. Do not spread database rows here.
  return {
    kind: "ok",
    portal: {
      hotelName: row.propertyName,
      city: row.city,
      roomLabel: cfg.showRoomLabel ? row.roomCode : null,
      welcomeMessage: cfg.welcomeMessage,
      accentColor: cfg.accentColor,
      logoUrl: cfg.logoUrl,
      coverImageUrl: cfg.coverImageUrl,
      wifi: cfg.wifiSsid ? { ssid: cfg.wifiSsid, password, note: cfg.wifiNote } : null,
      receptionPhone: cfg.receptionPhone,
      contactEmail: cfg.contactEmail,
      checkInTime: cfg.checkInTime,
      checkOutTime: cfg.checkOutTime,
      infoSections: cfg.infoSections.map((x) => ({ title: x.title, body: x.body })),
      privacyNotice: cfg.privacyNotice,
    },
    services: await listGuestServices(db, { tenantId: row.tenantId, propertyId: row.propertyId, timezone: row.timezone }),
  };
}

/**
 * The single place a raw QR token becomes a room context. Every guarantee lives here:
 * active code, live room, active property, tenant not suspended/cancelled, portal enabled.
 * Returns server-only ids; callers must not send them to the browser.
 */
export async function findActiveQr(db: Db, token: unknown) {
  if (!isWellFormedQrToken(token)) return null;
  const [row] = await db
    .select({
      qrId: roomQrCodes.id,
      tenantId: roomQrCodes.tenantId,
      propertyId: roomQrCodes.propertyId,
      roomId: roomQrCodes.roomId,
      roomCode: rooms.roomCode,
      propertyName: properties.name,
      city: properties.city,
      timezone: properties.timezone,
      currency: properties.currency,
      settings: guestPortalSettings,
    })
    .from(roomQrCodes)
    .innerJoin(
      rooms,
      and(eq(rooms.id, roomQrCodes.roomId), eq(rooms.propertyId, roomQrCodes.propertyId), eq(rooms.tenantId, roomQrCodes.tenantId)),
    )
    .innerJoin(properties, and(eq(properties.id, roomQrCodes.propertyId), eq(properties.tenantId, roomQrCodes.tenantId)))
    .innerJoin(tenants, eq(tenants.id, roomQrCodes.tenantId))
    .leftJoin(
      guestPortalSettings,
      and(eq(guestPortalSettings.propertyId, roomQrCodes.propertyId), eq(guestPortalSettings.tenantId, roomQrCodes.tenantId)),
    )
    .where(
      and(
        eq(roomQrCodes.tokenHash, hashQrToken(token)),
        eq(roomQrCodes.status, "active"),
        isNull(rooms.archivedAt),
        eq(properties.status, "active"),
        notInArray(tenants.status, [...BLOCKED_TENANT_STATUSES]),
      ),
    );
  if (!row) return null;
  if (row.settings && !row.settings.enabled) return null;
  return row;
}
