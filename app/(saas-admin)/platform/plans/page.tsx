import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Card, PageHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { requirePlatformAdmin } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { plans } from "@/lib/db/schema";
import { updatePlanAction } from "../actions";

export const metadata: Metadata = { title: "Plans" };

const label = "flex flex-col gap-1 text-xs";

/** SaaS operators edit commercial plans here; code never hardcodes prices or limits. */
export default async function PlansPage() {
  await requirePlatformAdmin();
  const rows = await getDb().select().from(plans).orderBy(asc(plans.sortOrder));

  return (
    <div>
      <PageHeader
        title="Plans & limits"
        description="Changes apply immediately to every hotel on the plan and are audited. Prices are in minor units (paise). Online checkout needs a Razorpay plan id with the SAME price, created in the Razorpay dashboard."
      />
      <ul className="space-y-4" aria-label="Plans">
        {rows.map((p) => (
          <li key={p.id}>
            <Card>
              <h2 className="mb-3 font-semibold">
                {p.name} <span className="text-xs font-normal text-muted-foreground">({p.key}{p.isDefault ? ", trial plan" : ""})</span>
              </h2>
              <ActionForm action={updatePlanAction.bind(null, p.id)} className="grid gap-3 sm:grid-cols-4" aria-label={`Edit ${p.name}`}>
                <label className={label}>
                  Name
                  <Input name="name" id={`${p.id}-name`} defaultValue={p.name} required />
                </label>
                <label className={`${label} sm:col-span-3`}>
                  Description
                  <Input name="description" id={`${p.id}-desc`} defaultValue={p.description ?? ""} />
                </label>
                <label className={label}>
                  Price / month (minor units)
                  <Input name="priceMinor" id={`${p.id}-price`} type="number" min={0} defaultValue={p.priceMinor} />
                </label>
                <label className={label}>
                  Razorpay plan id
                  <Input name="razorpayPlanId" id={`${p.id}-rzp`} placeholder="plan_…" defaultValue={p.razorpayPlanId ?? ""} />
                </label>
                <label className={label}>
                  Trial days
                  <Input name="trialDays" id={`${p.id}-trial`} type="number" min={0} max={365} defaultValue={p.trialDays} />
                </label>
                <span />
                <label className={label}>
                  Max rooms
                  <Input name="maxRooms" id={`${p.id}-rooms`} type="number" min={0} defaultValue={p.entitlements.maxRooms} />
                </label>
                <label className={label}>
                  Max properties
                  <Input name="maxProperties" id={`${p.id}-props`} type="number" min={0} defaultValue={p.entitlements.maxProperties} />
                </label>
                <label className={label}>
                  Max staff seats
                  <Input name="maxStaffSeats" id={`${p.id}-seats`} type="number" min={0} defaultValue={p.entitlements.maxStaffSeats} />
                </label>
                <div className="flex flex-col justify-end gap-1 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="reports" defaultChecked={p.entitlements.modules.reports} className="size-4" /> Reports
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="integrations" defaultChecked={p.entitlements.modules.integrations ?? false} className="size-4" /> Integrations (API, webhooks)
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="active" defaultChecked={p.active} className="size-4" /> Offered to hotels
                  </label>
                </div>
                <div className="sm:col-span-4">
                  <Button type="submit" size="sm">
                    Save {p.name}
                  </Button>
                </div>
              </ActionForm>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
