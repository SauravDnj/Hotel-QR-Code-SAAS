import Link from "next/link";
import { notFound } from "next/navigation";
import { PermissionDenied } from "@/components/permission-denied";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { can } from "@/lib/permissions/authorize";
import { getProperty } from "@/modules/properties/service";
import { PropertyTabs } from "./property-tabs";

export default async function PropertyLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  const ctx = await requireTenantContext();
  let property;
  try {
    // Tenant-scoped: another tenant's property id is a 404, never a leak.
    property = await getProperty(getDb(), ctx, propertyId);
  } catch (err) {
    if (err instanceof AppError && err.code === "not_found") notFound();
    if (err instanceof AppError && err.code === "forbidden") return <PermissionDenied />;
    throw err;
  }

  const scope = { propertyId: property.id };
  const tabs = [
    { href: "", label: "Settings" },
    ...(can(ctx, "room.view", scope)
      ? [
          { href: "/rooms", label: "Rooms" },
          { href: "/floors", label: "Floors" },
          { href: "/room-types", label: "Room types" },
        ]
      : []),
    ...(can(ctx, "qr.view", scope) ? [{ href: "/qr-codes", label: "QR codes" }] : []),
    { href: "/guest-portal", label: "Guest portal" },
    { href: "/departments", label: "Departments" },
  ];

  return (
    <>
      <p className="mb-1 text-sm text-muted-foreground">
        <Link href="/properties" className="underline-offset-4 hover:underline">
          Properties
        </Link>{" "}
        / {property.name}
      </p>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">{property.name}</h1>
      <PropertyTabs base={`/properties/${property.id}`} tabs={tabs} />
      {children}
    </>
  );
}
