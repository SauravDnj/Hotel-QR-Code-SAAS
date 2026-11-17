import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, ConfirmButton } from "@/components/action-form";
import { PermissionDenied } from "@/components/permission-denied";
import { Badge, Card, EmptyState } from "@/components/ui/card";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { can, canWrite } from "@/lib/permissions/authorize";
import { tomorrowIn } from "@/lib/timezones";
import { formatDateTime } from "@/lib/utils";
import { getPortalSettings } from "@/modules/guest-portal/settings";
import { listReservations } from "@/modules/reservations/service";
import { stayBalances } from "@/modules/ordering/folio";
import { formatMoney } from "@/lib/money";
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
  const showArrivals = can(ctx, "reservation.view", scope);
  const [{ stays }, available, portal, arrivals] = await Promise.all([
    listInHouse(db, ctx, selected.id),
    canIn ? listAvailableRooms(db, ctx, selected.id) : Promise.resolve([]),
    getPortalSettings(db, ctx, selected.id),
    showArrivals ? listReservations(db, ctx, selected.id, { view: "arrivals" }).then((l) => l.reservations) : Promise.resolve([]),
  ]);
  const tomorrow = tomorrowIn(selected.timezone);
  const showBills = can(ctx, "folio.view", scope);
  const balances = showBills ? await stayBalances(db, ctx.tenantId, stays.map((s) => s.stayId)) : new Map<string, number>();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Front desk</h1>
        <p className="text-sm text-muted-foreground">
          {selected.name}: {stays.length} in-house · {available.length} room{available.length === 1 ? "" : "s"} ready.{" "}
          <Link href={`/housekeeping?property=${selected.id}`} className="text-primary underline underline-offset-4">
            Room readiness →
          </Link>
        </p>
      </div>
      <PropertyPicker base="/front-desk" props={props} selectedId={selected.id} />

      {showArrivals && (
        <Card className="overflow-x-auto p-0">
          <h2 className="px-4 pt-4 text-sm font-semibold">Arrivals ({arrivals.length})</h2>
          {arrivals.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No bookings due today.</p>
          ) : (
            <table className="mt-2 w-full text-left text-sm" aria-label="Arrivals">
              <tbody>
                {arrivals.map((a) => (
                  <tr key={a.id} className="border-t border-border">
                    <td className="px-4 py-2 font-mono font-semibold">{a.code}</td>
                    <td className="px-4 py-2">
                      {a.guestName}
                      <div className="text-xs text-muted-foreground">
                        {a.categoryName} · {a.roomCode ?? "room not assigned"} · until {a.departureDate}
                      </div>
                    </td>
                    <td className="px-4 py-2">{a.late && <Badge tone="warning">Late arrival</Badge>}</td>
                    <td className="px-4 py-2 text-right">
                      <Link href={`/reservations/${a.id}?property=${selected.id}`} className="text-primary underline underline-offset-4">
                        {canIn ? "Check in" : "Open"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {canIn && (
        <Card>
          <h2 className="mb-1 text-sm font-semibold">Walk-in check-in</h2>
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
                {showBills && <th className="px-4 py-2 font-medium">Bill</th>}
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
                  {showBills && (
                    <td className="px-4 py-2">
                      <Link href={`/front-desk/folio/${s.stayId}?property=${selected.id}`} className="text-primary underline underline-offset-4">
                        {(balances.get(s.stayId) ?? 0) > 0 ? `${formatMoney(balances.get(s.stayId)!, selected.currency)} due` : "View bill"}
                      </Link>
                    </td>
                  )}
                  <td className="px-4 py-2 text-right">
                    {canOut && (
                      <ActionForm action={checkOutAction.bind(null, selected.id, s.stayId)} aria-label={`Check out room ${s.roomCode}`}>
                        {(balances.get(s.stayId) ?? 0) > 0 && (
                          <label className="mb-1 flex items-center justify-end gap-1 text-xs">
                            <input type="checkbox" name="allowBalance" className="size-3.5" /> Check out with balance due
                          </label>
                        )}
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
