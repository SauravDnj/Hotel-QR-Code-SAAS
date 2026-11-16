import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/card";
import { getDb } from "@/lib/db/client";
import { requireTenantContext } from "@/lib/auth/session";
import { can } from "@/lib/permissions/authorize";
import { listProperties } from "@/modules/properties/service";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const ctx = await requireTenantContext();
  const props = await listProperties(getDb(), ctx); // empty when the user has no property scope
  const roles = [...new Set(ctx.grants.map((g) => g.roleKey))];

  return (
    <>
      <PageHeader title="Dashboard" description={`Welcome to ${ctx.tenantName}.`} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-muted-foreground">Account status</p>
          <p className="mt-2">
            <Badge tone={ctx.tenantStatus === "suspended" ? "danger" : "success"}>{ctx.tenantStatus}</Badge>
          </p>
        </Card>
        <Card>
          <p className="text-sm text-muted-foreground">Properties</p>
          <p className="mt-1 text-3xl font-semibold">{props.length}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted-foreground">Your role</p>
          <p className="mt-2 text-sm font-medium">{roles.join(", ") || "No role assigned"}</p>
        </Card>
      </div>

      <h2 className="mb-3 mt-10 text-lg font-semibold">Getting started</h2>
      {props.length === 0 ? (
        <EmptyState
          title="No properties yet"
          description="Add your first hotel property to continue setup."
          action={
            can(ctx, "property.manage") ? (
              <Link href="/properties/new" className={buttonVariants()}>
                Add property
              </Link>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            {props.map((p) => (
              <li key={p.id}>
                <span className="font-medium">{p.name}:</span> add{" "}
                <Link className="text-primary underline-offset-4 hover:underline" href={`/properties/${p.id}/floors`}>floors</Link>,{" "}
                <Link className="text-primary underline-offset-4 hover:underline" href={`/properties/${p.id}/room-types`}>room types</Link>,{" "}
                <Link className="text-primary underline-offset-4 hover:underline" href={`/properties/${p.id}/rooms`}>rooms</Link>,{" "}
                <Link className="text-primary underline-offset-4 hover:underline" href={`/properties/${p.id}/guest-portal`}>guest portal &amp; Wi-Fi</Link>, then{" "}
                <Link className="text-primary underline-offset-4 hover:underline" href={`/properties/${p.id}/qr-codes`}>print QR codes</Link>.
              </li>
            ))}
            {props.map((p) => (
              <li key={`svc-${p.id}`}>
                <span className="font-medium">{p.name}:</span> set up{" "}
                <Link className="text-primary underline-offset-4 hover:underline" href={`/properties/${p.id}/services`}>guest services</Link>, then watch the{" "}
                <Link className="text-primary underline-offset-4 hover:underline" href="/inbox">request inbox</Link>.
              </li>
            ))}
          </ol>
        </Card>
      )}
    </>
  );
}
