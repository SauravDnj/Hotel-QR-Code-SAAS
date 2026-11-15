import type { Metadata } from "next";
import { PermissionDenied } from "@/components/permission-denied";
import { PageHeader } from "@/components/ui/card";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { can } from "@/lib/permissions/authorize";
import { getTenantSettings } from "@/modules/tenants/settings";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Hotel settings" };

export default async function SettingsPage() {
  const ctx = await requireTenantContext();
  if (!can(ctx, "tenant.manage")) return <PermissionDenied />;
  const t = await getTenantSettings(getDb(), ctx);
  return (
    <>
      <PageHeader title="Hotel settings" description="Account-wide details. Each property can override timezone and currency." />
      <SettingsForm
        readOnly={t.status === "suspended" || t.status === "cancelled"}
        initial={{
          name: t.name,
          legalName: t.legalName,
          contactEmail: t.contactEmail,
          country: t.country,
          timezone: t.timezone,
          currency: t.currency,
        }}
      />
    </>
  );
}
