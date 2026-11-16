import { sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { qrStatus } from "./enums";
import { users } from "./identity";
import { rooms } from "./structure";
import { properties, tenants, timestamps } from "./tenancy";

/**
 * Room QR codes (Phase 3). The raw token is never stored in plain text:
 * - `token_hash` = HMAC-SHA256(QR_TOKEN_PEPPER, token), used for the public lookup;
 * - `token_ciphertext` = AES-GCM(ENCRYPTION_KEY, token), so admins can reprint the same sticker.
 * Revoked/rotated rows are kept as history. At most one active code per room.
 */
export const roomQrCodes = pgTable(
  "room_qr_codes",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    propertyId: uuid("property_id").notNull(),
    roomId: uuid("room_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    tokenCiphertext: text("token_ciphertext").notNull(),
    status: qrStatus("status").notNull().default("active"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    issuedByUserId: uuid("issued_by_user_id").references(() => users.id),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByUserId: uuid("revoked_by_user_id").references(() => users.id),
    /** deactivated (can be reactivated) | rotated | compromised */
    revokeReason: text("revoke_reason"),
    lastScannedAt: timestamp("last_scanned_at", { withTimezone: true }),
    scanCount: integer("scan_count").notNull().default(0),
  },
  (t) => [
    foreignKey({
      name: "room_qr_codes_room_scope_fk",
      columns: [t.roomId, t.propertyId, t.tenantId],
      foreignColumns: [rooms.id, rooms.propertyId, rooms.tenantId],
    }).onDelete("restrict"),
    uniqueIndex("room_qr_codes_token_hash_unique").on(t.tokenHash),
    uniqueIndex("room_qr_codes_one_active_per_room").on(t.roomId).where(sql`${t.status} = 'active'`),
    index("room_qr_codes_scope_idx").on(t.tenantId, t.propertyId, t.status),
    index("room_qr_codes_room_idx").on(t.tenantId, t.roomId, t.issuedAt),
  ],
);

export interface PortalInfoSection {
  title: string;
  body: string;
}

/**
 * Guest-facing configuration of one property's portal. Only the fields read by
 * `modules/guest-portal/public.ts` are ever sent to guests; the Wi-Fi password is
 * encrypted at rest and never returned to the admin UI.
 */
export const guestPortalSettings = pgTable(
  "guest_portal_settings",
  {
    propertyId: uuid("property_id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    showRoomLabel: boolean("show_room_label").notNull().default(true),
    welcomeMessage: text("welcome_message"),
    accentColor: text("accent_color"),
    logoUrl: text("logo_url"),
    coverImageUrl: text("cover_image_url"),
    wifiSsid: text("wifi_ssid"),
    wifiPasswordCiphertext: text("wifi_password_ciphertext"),
    wifiNote: text("wifi_note"),
    receptionPhone: text("reception_phone"),
    contactEmail: text("contact_email"),
    checkInTime: text("check_in_time"),
    checkOutTime: text("check_out_time"),
    infoSections: jsonb("info_sections").$type<PortalInfoSection[]>().notNull().default([]),
    privacyNotice: text("privacy_notice"),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "guest_portal_settings_property_fk",
      columns: [t.propertyId, t.tenantId],
      foreignColumns: [properties.id, properties.tenantId],
    }).onDelete("restrict"),
  ],
);
