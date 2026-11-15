import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Badge, Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { listUserTenants } from "@/modules/tenants/context";
import { selectTenantAction } from "./actions";

export const metadata: Metadata = { title: "Choose hotel" };

export default async function SelectTenantPage() {
  const user = await requireUser();
  const tenants = await listUserTenants(getDb(), user.id);
  if (tenants.length === 0) redirect(user.isPlatformAdmin ? "/platform" : "/no-access");

  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <h1 className="mb-6 text-xl font-semibold">Choose a hotel</h1>
      <Card className="divide-y divide-border p-0">
        {tenants.map((t) => (
          <form key={t.tenantId} action={selectTenantAction} className="flex items-center justify-between gap-3 p-4">
            <input type="hidden" name="tenantId" value={t.tenantId} />
            <div>
              <p className="font-medium">{t.name}</p>
              <Badge tone={t.status === "suspended" ? "danger" : "success"}>{t.status}</Badge>
            </div>
            <Button size="sm" type="submit">
              Open
            </Button>
          </form>
        ))}
      </Card>
    </main>
  );
}
