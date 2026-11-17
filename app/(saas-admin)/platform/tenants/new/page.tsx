import type { Metadata } from "next";
import Link from "next/link";
import { Card, PageHeader } from "@/components/ui/card";
import { requirePlatformAdmin } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { listActivePlans } from "@/modules/billing/plans";
import { CreateHotelForm } from "./create-hotel-form";

export const metadata: Metadata = { title: "Add hotel" };

export default async function NewTenantPage() {
  await requirePlatformAdmin();
  const plans = await listActivePlans(getDb());
  return (
    <div className="max-w-2xl">
      <Link href="/platform/tenants" className="text-sm text-primary underline underline-offset-4">
        ← Hotels
      </Link>
      <PageHeader title="Add hotel" description="Creates the hotel account, its first property and the owner's login." />
      <Card>
        <CreateHotelForm plans={plans.map((p) => ({ id: p.id, name: p.name, isDefault: p.isDefault }))} />
      </Card>
    </div>
  );
}
