import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PermissionDenied } from "@/components/permission-denied";
import { Alert } from "@/components/ui/card";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { assertTenantWritable, can } from "@/lib/permissions/authorize";
import { getProperty } from "@/modules/properties/service";
import { updatePropertyAction } from "../actions";
import { PropertyForm } from "../property-form";

export const metadata: Metadata = { title: "Property" };

export default async function PropertyPage({
  params,
  searchParams,
}: {
  params: Promise<{ propertyId: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { propertyId } = await params;
  const { saved } = await searchParams;
  const ctx = await requireTenantContext();

  let property;
  try {
    property = await getProperty(getDb(), ctx, propertyId);
  } catch (err) {
    if (err instanceof AppError && err.code === "not_found") notFound();
    if (err instanceof AppError && err.code === "forbidden") return <PermissionDenied />;
    throw err;
  }

  let writable = true;
  try {
    assertTenantWritable(ctx);
  } catch {
    writable = false;
  }
  const canEdit = writable && can(ctx, "property.manage", { propertyId: property.id });

  return (
    <>
      <h2 className="mb-4 text-lg font-semibold">Property settings</h2>
      {saved && <Alert tone="success" className="mb-4">Property created. Next, add floors and room types, then rooms.</Alert>}
      <PropertyForm
        action={updatePropertyAction.bind(null, property.id)}
        initial={{
          name: property.name,
          addressLine1: property.addressLine1,
          addressLine2: property.addressLine2,
          city: property.city,
          state: property.state,
          postalCode: property.postalCode,
          country: property.country,
          timezone: property.timezone,
          currency: property.currency,
          status: property.status,
        }}
        submitLabel="Save changes"
        readOnly={!canEdit}
      />
    </>
  );
}
