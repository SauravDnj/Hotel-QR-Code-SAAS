import type { Metadata } from "next";
import Link from "next/link";
import { PermissionDenied } from "@/components/permission-denied";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { loadOr404 } from "@/lib/page-errors";
import { can, canWrite } from "@/lib/permissions/authorize";
import { listPortalMedia, MAX_GALLERY_PHOTOS, previewPortal } from "@/modules/guest-portal/design";
import {
  removeBrandAction,
  removeGalleryAction,
  removeServiceImageAction,
  saveDesignAction,
  updateGalleryAction,
  uploadBrandAction,
  uploadGalleryAction,
  uploadServiceImageAction,
} from "./actions";
import { DesignForm } from "./design-form";
import { Photos } from "./photos";

export const metadata: Metadata = { title: "Guest page design" };

export default async function DesignPage({ params }: { params: Promise<{ propertyId: string }> }) {
  const { propertyId } = await params;
  const ctx = await requireTenantContext();
  if (!can(ctx, "property.view", { propertyId })) return <PermissionDenied />;
  const [{ portal, services, settings }, media] = await loadOr404(() =>
    Promise.all([previewPortal(getDb(), ctx, propertyId), listPortalMedia(getDb(), ctx, propertyId)]),
  );
  const manage = canWrite(ctx, "property.manage", { propertyId });
  const manageServices = canWrite(ctx, "service.manage", { propertyId });

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold">Guest page design</h2>
        <p className="text-sm text-muted-foreground">
          Change how the page looks when guests scan a room QR code: template, colours, font and photos. Changes show in the preview straight away and
          reach guests once saved. Wi-Fi, contact details and hotel information are on the{" "}
          <Link href={`/properties/${propertyId}/guest-portal`} className="text-primary underline underline-offset-4">
            Guest portal
          </Link>{" "}
          tab.
        </p>
      </div>

      <DesignForm
        action={saveDesignAction.bind(null, propertyId)}
        initial={{
          theme: portal.theme,
          accentColor: portal.accentColor ?? "",
          backgroundColor: portal.backgroundColor ?? "",
          fontStyle: portal.fontStyle,
          showGallery: settings?.showGallery ?? true,
        }}
        portal={portal}
        services={services}
        readOnly={!manage}
      />

      <section aria-labelledby="photos-h" className="space-y-3">
        <h2 id="photos-h" className="text-lg font-semibold">
          Photos
        </h2>
        <Photos
          readOnly={!manage}
          maxGallery={MAX_GALLERY_PHOTOS}
          logo={{ url: media.logoUrl, upload: uploadBrandAction.bind(null, propertyId, "logo"), remove: removeBrandAction.bind(null, propertyId, "logo") }}
          cover={{ url: media.coverUrl, upload: uploadBrandAction.bind(null, propertyId, "cover"), remove: removeBrandAction.bind(null, propertyId, "cover") }}
          gallery={{
            upload: uploadGalleryAction.bind(null, propertyId),
            items: media.gallery.map((g) => ({
              id: g.id,
              url: g.url,
              caption: g.caption,
              update: updateGalleryAction.bind(null, propertyId, g.id),
              remove: removeGalleryAction.bind(null, propertyId, g.id),
            })),
          }}
          services={media.services.map((s) => ({
            id: s.id,
            name: s.name,
            icon: s.icon,
            enabled: s.enabled,
            imageUrl: s.imageUrl,
            upload: uploadServiceImageAction.bind(null, propertyId, s.id),
            remove: removeServiceImageAction.bind(null, propertyId, s.id),
          }))}
        />
        {!manageServices && manage && <p className="text-xs text-muted-foreground">You can view service photos but not change them.</p>}
      </section>
    </div>
  );
}

