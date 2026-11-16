import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, ConfirmButton } from "@/components/action-form";
import { PermissionDenied } from "@/components/permission-denied";
import { Badge, Card, EmptyState } from "@/components/ui/card";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { canWrite } from "@/lib/permissions/authorize";
import { tomorrowIn } from "@/lib/timezones";
import { formatDateTime } from "@/lib/utils";
import { getPortalSettings } from "@/modules/guest-portal/settings";
import { listAvailableRooms, listInHouse } from "@/modules/stays/service";
import { PropertyPicker, propertiesFor } from "../property-picker";
import { checkInAction, checkOutAction } from "./actions";
import { CheckInForm } from "./checkin-form";

export const metadata: Metadata = { title: "Front desk" };

/** Reception: check guests in to READY rooms and check them out (creates a cleaning task). */
export default async function FrontDeskPage({ searchParams }: { searchParams: Promise<{ property?: string }> }) {
  const { property: requested } = await searchParams;
  const ctx = await requireTenantContext();
  const db = getDb();
  const { props, selected } = await propertiesFor(db, ctx, "stay.view", requested);
  if (!selected) return <PermissionDenied />;
  const scope = { propertyId: selected.id };
  const canIn = canWrite(ctx, "stay.check_in", scope);
  const canOut = canWrite(ctx, "stay.check_out", scope);
  const [{ stays }, available, portal] = await Promise.all([
    listInHouse(db, ctx, selected.id),
    canIn ? listAvailableRooms(db, ctx, selected.id) : Promise.resolve([]),
    getPortalSettings(db, ctx, selected.id),
  ]);
  const tomorrow = tomorrowIn(selected.timezone);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Front desk</h1>
        <p className="text-sm text-muted-foreground">
          {selected.name}: {stays.length} in-house · {available.length} room{available.length === 1 ? "" : "s"} ready.{" "}
          <Link href={`/housekeeping?property=${selected.id}`} className="text-primary underline-offset-4 hover:underline">
            Room readiness →
          </Link>
        </p>
      </div>
      <PropertyPicker base="/front-desk" props={props} selectedId={selected.id} />

      {canIn && (
        <Card>
          <h2 className="mb-1 text-sm font-semibold">Check in</h2>
          <p className="mb-4 text-xs text-muted-foreground">
            Only rooms that are in service, vacant, cleaned{" "}
            {selected.requireInspection ? "and inspected " : ""}are offered. Guest details stay private to reception.
          </p>
          <CheckInForm
            action={checkInAction.bind(null, selected.id)}
            rooms={available}
            defaultDate={tomorrow}
            defaultTime={portal.settings.checkOutTime ?? "11:00"}
          />
        </Card>
      )}

      <Card className="overflow-x-auto p-0">
        <h2 className="px-4 pt-4 text-sm font-semibold">In-house guests</h2>
        {stays.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No guests checked in" description="Checked-in guests appear here with their expected checkout." />
          </div>
        ) : (
          <table className="mt-2 w-full text-left text-sm" aria-label="In-house guests">
            <thead className="border-b border-border text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Room</th>
                <th className="px-4 py-2 font-medium">Guest</th>
                <th className="px-4 py-2 font-medium">Checked in</th>
                <th className="px-4 py-2 font-medium">Expected checkout</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {stays.map((s) => (
                <tr key={s.stayId} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 font-semibold">{s.roomCode}</td>
                  <td className="px-4 py-2">
                    {s.guestName}
                    <div className="text-xs text-muted-foreground">
                      {s.adults} guest{s.adults === 1 ? "" : "s"}
                      {s.phone && <> · {s.phone}</>}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{formatDateTime(s.checkInAt, selected.timezone)}</td>
                  <td className="px-4 py-2">
                    {formatDateTime(s.expectedCheckoutAt, selected.timezone)}{" "}
                    {s.overdue ? <Badge tone="danger">Overdue</Badge> : s.departsToday && <Badge tone="warning">Today</Badge>}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {canOut && (
                      <ActionForm action={checkOutAction.bind(null, selected.id, s.stayId)} aria-label={`Check out room ${s.roomCode}`}>
                        <ConfirmButton size="sm" variant="secondary" confirmLabel="Confirm checkout">
                          Check out
                        </ConfirmButton>
                      </ActionForm>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
