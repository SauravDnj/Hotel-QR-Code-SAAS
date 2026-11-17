import { AutoRefresh } from "@/components/auto-refresh";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PermissionDenied } from "@/components/permission-denied";
import { Card, PageHeader } from "@/components/ui/card";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { can } from "@/lib/permissions/authorize";
import { listProperties } from "@/modules/properties/service";

export const metadata: Metadata = { title: "Rooms" };

/** Sidebar entry: goes straight to the rooms of the only property, or lets the user pick. */
export default async function RoomsIndexPage() {
  const ctx = await requireTenantContext();
  const props = (await listProperties(getDb(), ctx)).filter((p) => can(ctx, "room.view", { propertyId: p.id }));
  if (props.length === 0) return <PermissionDenied />;
  if (props.length === 1) redirect(`/properties/${props[0].id}/rooms`);
  return (
    <>
      <AutoRefresh seconds={30} />
      <PageHeader title="Rooms" description="Choose a property." />
      <div className="grid gap-3 sm:grid-cols-2">
        {props.map((p) => (
          <Link key={p.id} href={`/properties/${p.id}/rooms`}>
            <Card className="hover:border-primary">
              <p className="font-medium">{p.name}</p>
              <p className="text-sm text-muted-foreground">{p.city ?? p.timezone}</p>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
