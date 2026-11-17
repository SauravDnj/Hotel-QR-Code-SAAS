import type { Metadata } from "next";
import Link from "next/link";
import { PermissionDenied } from "@/components/permission-denied";
import { Card, PageHeader } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
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
      <Card className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Export your data</h2>
          <p className="text-xs text-muted-foreground">
            Download everything your hotel has stored here as JSON: rooms, services, staff, stays, guest records, requests,
            housekeeping and the audit log. No passwords or secrets are included. Contains guest personal data, so store it securely.
          </p>
        </div>
        <a href="/api/export" className={buttonVariants({ variant: "secondary" })} download>
          Download export
        </a>
      </Card>
      <Card className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Integrations</h2>
          <p className="text-xs text-muted-foreground">
            API keys and webhooks for your PMS, channel manager or POS system.
          </p>
        </div>
        <Link href="/settings/integrations" className={buttonVariants({ variant: "secondary" })}>
          Manage integrations
        </Link>
      </Card>
    </>
  );
}
