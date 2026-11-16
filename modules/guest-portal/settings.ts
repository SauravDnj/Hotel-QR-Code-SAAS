import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/types";
import { guestPortalSettings, type PortalInfoSection } from "@/lib/db/schema";
import { encryptSecret } from "@/lib/crypto/secrets";
import type { TenantContext } from "@/lib/permissions/authorize";
import { optionalText } from "@/lib/validation/common";
import { writeAudit } from "@/modules/audit/service";
import { requireProperty } from "@/modules/properties/access";

export const MAX_INFO_SECTIONS = 6;

const checkbox = z
  .union([z.literal("on"), z.literal("true"), z.literal(""), z.boolean()])
  .optional()
  .transform((v) => v === true || v === "on" || v === "true");

const time = z
  .string()
  .trim()
  .regex(/^$|^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MM")
  .optional()
  .transform((v) => (v ? v : null));

const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^https:\/\/[^\s"'<>]+$/i.test(v), "Use an https:// image URL");

export const portalSettingsSchema = z
  .object({
    enabled: checkbox,
    showRoomLabel: checkbox,
    welcomeMessage: optionalText(300),
    accentColor: z
      .string()
      .trim()
      .regex(/^$|^#[0-9a-fA-F]{6}$/, "Use a hex colour like #1E3A5F")
      .optional()
      .transform((v) => (v ? v.toLowerCase() : null)),
    logoUrl: httpsUrl,
    coverImageUrl: httpsUrl,
    // 802.11 limits: SSID ≤ 32 bytes, WPA passphrase ≤ 63 characters.
    wifiSsid: optionalText(32),
    wifiPassword: z.string().max(63, "Wi-Fi password is too long").optional(),
    clearWifiPassword: checkbox,
    wifiNote: optionalText(200),
    receptionPhone: z
      .string()
      .trim()
      .regex(/^$|^\+?[0-9 ()-]{5,20}$/, "Use digits, spaces, + ( ) or -")
      .optional()
      .transform((v) => (v ? v : null)),
    contactEmail: z
      .union([z.literal(""), z.email("Enter a valid email address").max(254)])
      .optional()
      .transform((v) => (v ? v.toLowerCase() : null)),
    checkInTime: time,
    checkOutTime: time,
    privacyNotice: optionalText(1000),
    infoSections: z
      .array(z.object({ title: z.string().trim().max(60, "Title is too long"), body: z.string().trim().max(1000, "Text is too long") }))
      .max(MAX_INFO_SECTIONS)
      .default([])
      .transform((list) => list.filter((s) => s.title || s.body).map((s) => ({ title: s.title || "Information", body: s.body }))),
  });
export type PortalSettingsInput = z.input<typeof portalSettingsSchema>;

/** Rebuilds the nested section list from flat form fields (sectionTitle0, sectionBody0, …). */
export function portalInputFromForm(values: Record<string, string>): PortalSettingsInput {
  const infoSections = Array.from({ length: MAX_INFO_SECTIONS }, (_, i) => ({
    title: values[`sectionTitle${i}`] ?? "",
    body: values[`sectionBody${i}`] ?? "",
  }));
  return { ...values, infoSections } as PortalSettingsInput;
}

export const DEFAULT_PORTAL = {
  enabled: true,
  showRoomLabel: true,
  welcomeMessage: null,
  accentColor: null,
  logoUrl: null,
  coverImageUrl: null,
  wifiSsid: null,
  wifiNote: null,
  receptionPhone: null,
  contactEmail: null,
  checkInTime: null,
  checkOutTime: null,
  infoSections: [] as PortalInfoSection[],
  privacyNotice: null,
};

/** Admin view. The Wi-Fi password is write-only: only whether one is set is returned. */
export async function getPortalSettings(db: Db, ctx: TenantContext, propertyId: string) {
  const property = await requireProperty(db, ctx, propertyId, "property.view");
  const [row] = await db
    .select()
    .from(guestPortalSettings)
    .where(and(eq(guestPortalSettings.propertyId, property.id), eq(guestPortalSettings.tenantId, ctx.tenantId)));
  if (!row) return { property, settings: { ...DEFAULT_PORTAL, hasWifiPassword: false, updatedAt: null as Date | null } };
  const { wifiPasswordCiphertext, ...rest } = row;
  return { property, settings: { ...rest, hasWifiPassword: Boolean(wifiPasswordCiphertext) } };
}

export async function updatePortalSettings(db: Db, ctx: TenantContext, propertyId: string, raw: PortalSettingsInput) {
  const property = await requireProperty(db, ctx, propertyId, "property.manage", { write: true });
  const { wifiPassword, clearWifiPassword, ...input } = portalSettingsSchema.parse(raw);

  // Blank password field = keep the stored one. Never echo it back.
  let wifiPasswordCiphertext: string | null | undefined;
  if (clearWifiPassword) wifiPasswordCiphertext = null;
  else if (wifiPassword) wifiPasswordCiphertext = encryptSecret(wifiPassword);

  const values = {
    ...input,
    ...(wifiPasswordCiphertext !== undefined ? { wifiPasswordCiphertext } : {}),
    updatedByUserId: ctx.userId,
  };

  await db.transaction(async (tx) => {
    await tx
      .insert(guestPortalSettings)
      .values({ ...values, propertyId: property.id, tenantId: ctx.tenantId })
      .onConflictDoUpdate({ target: guestPortalSettings.propertyId, set: values, setWhere: eq(guestPortalSettings.tenantId, ctx.tenantId) });
    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      actorType: "user",
      action: "guest_portal.updated",
      entityType: "property",
      entityId: property.id,
      // Field names only; never values (the Wi-Fi password in particular).
      metadata: {
        enabled: input.enabled,
        wifiCredentialChanged: wifiPasswordCiphertext !== undefined,
      },
    });
  });
}
