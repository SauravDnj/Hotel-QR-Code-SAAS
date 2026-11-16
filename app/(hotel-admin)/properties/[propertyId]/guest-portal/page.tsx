import type { Metadata } from "next";
import Link from "next/link";
import { PermissionDenied } from "@/components/permission-denied";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { loadOr404 } from "@/lib/page-errors";
import { can, canWrite } from "@/lib/permissions/authorize";
import { getPortalSettings, MAX_INFO_SECTIONS } from "@/modules/guest-portal/settings";
import { updatePortalAction } from "../qr-actions";
import { PortalForm } from "./portal-form";

export const metadata: Metadata = { title: "Guest portal" };

export default async function GuestPortalPage({ params }: { params: Promise<{ propertyId: string }> }) {
  const { propertyId } = await params;
  const ctx = await requireTenantContext();
  if (!can(ctx, "property.view", { propertyId })) return <PermissionDenied />;
  const { settings } = await loadOr404(() => getPortalSettings(getDb(), ctx, propertyId));
  const manage = canWrite(ctx, "property.manage", { propertyId });

  const initial: Record<string, string> = {
    enabled: settings.enabled ? "on" : "",
    showRoomLabel: settings.showRoomLabel ? "on" : "",
    welcomeMessage: settings.welcomeMessage ?? "",
    accentColor: settings.accentColor ?? "",
    logoUrl: settings.logoUrl ?? "",
    coverImageUrl: settings.coverImageUrl ?? "",
    wifiSsid: settings.wifiSsid ?? "",
    wifiNote: settings.wifiNote ?? "",
    receptionPhone: settings.receptionPhone ?? "",
    contactEmail: settings.contactEmail ?? "",
    checkInTime: settings.checkInTime ?? "",
    checkOutTime: settings.checkOutTime ?? "",
    privacyNotice: settings.privacyNotice ?? "",
  };
  settings.infoSections.forEach((s, i) => {
    initial[`sectionTitle${i}`] = s.title;
    initial[`sectionBody${i}`] = s.body;
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Guest portal</h2>
        <p className="text-sm text-muted-foreground">
          What guests see after scanning a room QR code. To preview it, open any room from the{" "}
          <Link href={`/properties/${propertyId}/qr-codes`} className="text-primary underline-offset-4 hover:underline">
            QR codes
          </Link>{" "}
          page and choose “Open guest page”. The page never shows guest names, stay details or request history.
        </p>
      </div>
      <PortalForm
        action={updatePortalAction.bind(null, propertyId)}
        initial={initial}
        hasWifiPassword={settings.hasWifiPassword}
        sections={MAX_INFO_SECTIONS}
        readOnly={!manage}
      />
    </div>
  );
}
