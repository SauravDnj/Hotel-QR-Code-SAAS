import type { Metadata } from "next";
import Link from "next/link";
import { PermissionDenied } from "@/components/permission-denied";
import { Badge, Card, EmptyState } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { canWrite } from "@/lib/permissions/authorize";
import { addDays, localDate } from "@/lib/timezones";
import { cn } from "@/lib/utils";
import { bookingOptions, listReservations, reservationCalendar, type ReservationView } from "@/modules/reservations/service";
import { PropertyPicker, propertiesFor } from "../property-picker";
import { createReservationAction } from "./actions";
import { ReservationCalendar } from "./calendar";
import { ReservationForm } from "./reservation-form";

export const metadata: Metadata = { title: "Reservations" };

const VIEWS: { key: "calendar" | ReservationView; label: string }[] = [
  { key: "calendar", label: "Calendar" },
  { key: "arrivals", label: "Arrivals" },
  { key: "upcoming", label: "Upcoming" },
  { key: "in_house", label: "In house" },
  { key: "closed", label: "Closed" },
];

const STATUS: Record<string, { label: string; tone: "info" | "success" | "warning" | "danger" }> = {
  confirmed: { label: "Confirmed", tone: "info" },
  checked_in: { label: "Checked in", tone: "success" },
  completed: { label: "Completed", tone: "info" },
  cancelled: { label: "Cancelled", tone: "danger" },
  no_show: { label: "No-show", tone: "warning" },
};

/** Reservations: availability calendar, lists, and new bookings (Phase 9). */
export default async function ReservationsPage({
  searchParams,
}: {
  searchParams: Promise<{ property?: string; view?: string; from?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await requireTenantContext();
  const db = getDb();
  const { props, selected } = await propertiesFor(db, ctx, "reservation.view", sp.property);
  if (!selected) return <PermissionDenied />;
  const view = (VIEWS.find((v) => v.key === sp.view)?.key ?? "calendar") as (typeof VIEWS)[number]["key"];
  const canManage = canWrite(ctx, "reservation.manage", { propertyId: selected.id });
  const today = localDate(new Date(), selected.timezone);
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : today;
  const base = `/reservations?property=${selected.id}`;

  const [options, cal, list] = await Promise.all([
    bookingOptions(db, ctx, selected.id),
    view === "calendar" ? reservationCalendar(db, ctx, selected.id, from, 14) : null,
    view !== "calendar" ? listReservations(db, ctx, selected.id, { view, q: sp.q }) : null,
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reservations</h1>
        <p className="text-sm text-muted-foreground">
          {selected.name}: bookings by room type, assigned rooms and free rooms per night. Room types are never overbooked.
        </p>
      </div>
      <PropertyPicker base="/reservations" props={props} selectedId={selected.id} />

      <nav aria-label="Reservation views" className="flex flex-wrap gap-2 text-sm">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={`${base}&view=${v.key}`}
            aria-current={v.key === view ? "page" : undefined}
            className={cn(
              "rounded-full border border-border px-3 py-1.5",
              v.key === view ? "bg-primary text-primary-foreground" : "bg-surface hover:bg-surface-muted",
            )}
          >
            {v.label}
          </Link>
        ))}
      </nav>

      {cal && (
        <Card className="space-y-3 p-0 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4">
            <h2 className="text-sm font-semibold">
              {cal.nights[0]} to {cal.nights.at(-1)}
            </h2>
            <div className="flex gap-3 text-sm">
              <Link className="text-primary underline underline-offset-4" href={`${base}&from=${addDays(from, -14)}`}>
                ← Earlier
              </Link>
              <Link className="text-primary underline underline-offset-4" href={base}>
                Today
              </Link>
              <Link className="text-primary underline underline-offset-4" href={`${base}&from=${addDays(from, 14)}`}>
                Later →
              </Link>
            </div>
          </div>
          {cal.categories.length === 0 ? (
            <div className="p-4">
              <EmptyState title="No rooms yet" description="Add room types and rooms to the property to take bookings." />
            </div>
          ) : (
            <ReservationCalendar cal={cal} propertyId={selected.id} />
          )}
        </Card>
      )}

      {list && (
        <Card className="overflow-x-auto p-0">
          <form className="flex gap-2 p-4" role="search">
            <input type="hidden" name="property" value={selected.id} />
            <input type="hidden" name="view" value={view} />
            <label htmlFor="q" className="sr-only">
              Search bookings
            </label>
            <Input name="q" defaultValue={sp.q ?? ""} placeholder="Code, guest name or phone" className="max-w-xs" />
          </form>
          {list.reservations.length === 0 ? (
            <div className="p-4 pt-0">
              <EmptyState title="No bookings here" description="Bookings matching this view appear here." />
            </div>
          ) : (
            <table className="w-full text-left text-sm" aria-label="Bookings">
              <thead className="border-b border-border text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Code</th>
                  <th className="px-4 py-2 font-medium">Guest</th>
                  <th className="px-4 py-2 font-medium">Dates</th>
                  <th className="px-4 py-2 font-medium">Room</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {list.reservations.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2 font-mono font-semibold">
                      <Link className="text-primary underline underline-offset-4" href={`/reservations/${r.id}?property=${selected.id}`}>
                        {r.code}
                      </Link>
                    </td>
                    <td className="px-4 py-2">
                      {r.guestName}
                      <div className="text-xs text-muted-foreground">
                        {r.adults} guest{r.adults === 1 ? "" : "s"}
                        {r.phone && <> · {r.phone}</>}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      {r.arrivalDate} → {r.departureDate}
                      <div className="text-xs text-muted-foreground">
                        {r.nights} night{r.nights === 1 ? "" : "s"}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      {r.categoryName}
                      <div className="text-xs text-muted-foreground">{r.roomCode ?? "Unassigned"}</div>
                    </td>
                    <td className="px-4 py-2">
                      <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge> {r.late && <Badge tone="warning">Late arrival</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {canManage && (
        <Card>
          <h2 className="mb-1 text-sm font-semibold">New booking</h2>
          <p className="mb-4 text-xs text-muted-foreground">
            Checks every night against free rooms of the chosen type. Assign a room now or at check-in.
          </p>
          <ReservationForm
            action={createReservationAction.bind(null, selected.id)}
            categories={options.categories}
            rooms={options.rooms}
            defaults={{ arrivalDate: today, departureDate: addDays(today, 1), adults: 2 }}
            submitLabel="Create booking"
          />
        </Card>
      )}
    </div>
  );
}
