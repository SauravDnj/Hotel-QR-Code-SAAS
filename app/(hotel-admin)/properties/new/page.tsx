import type { Metadata } from "next";
import { PermissionDenied } from "@/components/permission-denied";
import { PageHeader } from "@/components/ui/card";
import { requireTenantContext } from "@/lib/auth/session";
import { can } from "@/lib/permissions/authorize";
import { createPropertyAction } from "../actions";
import { PropertyForm } from "../property-form";

export const metadata: Metadata = { title: "Add property" };

export default async function NewPropertyPage() {
  const ctx = await requireTenantContext();
  if (!can(ctx, "property.manage")) return <PermissionDenied />;
  return (
    <>
      <PageHeader title="Add property" description="Each property has its own timezone, currency and rooms." />
      <PropertyForm action={createPropertyAction} submitLabel="Create property" />
    </>
  );
}
