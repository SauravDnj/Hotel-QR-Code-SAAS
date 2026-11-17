import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, ConfirmButton } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { canWrite } from "@/lib/permissions/authorize";
import { loadOr404 } from "@/lib/page-errors";
import { eachNight, localDate } from "@/lib/timezones";
import { bookingOptions, getReservation } from "@/modules/reservations/service";
import { listAvailableRooms } from "@/modules/stays/service";
import { checkInReservationAction, closeReservationAction, updateReservationAction } from "../actions";
import { ReservationForm } from "../reservation-form";

export const metadata: Metadata = { title: "Booking" };

const SOURCE_LABEL: Record<string, string> = {
  direct: "Direct",
  phone: "Phone",
  email: "Email",
  walk_in: "Walk-in",
  ota: "Online travel agency",
  api: "Integration",
};

export default async function ReservationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ property?: string }>;
}) {
  const [{ id }, { property }] = await Promise.all([params, searchParams]);
  const ctx = await requireTenantContext();
  const db = getDb();
  const data = await loadOr404(() => getReservation(db, ctx, property ?? "", id));
  const { r, property: prop } = data;
  const scope = { propertyId: prop.id };
  const today = localDate(new Date(), prop.timezone);
  const confirmed = r.status === "confirmed";
  const canManage = confirmed && canWrite(ctx, "reservation.manage", scope);
  const canCheckIn = confirmed && r.arrivalDate <= today && r.departureDate > today && canWrite(ctx, "stay.check_in", scope);
  const [options, ready] = await Promise.all([
    canManage ? bookingOptions(db, ctx, prop.id) : null,
    canCheckIn ? listAvailableRooms(db, ctx, prop.id) : [],
  ]);
  const nights = eachNight(r.arrivalDate, r.departureDate).length;
  const assignedReady = r.roomId && ready.some((x) => x.id === r.roomId);

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/reservations?property=${prop.id}&view=upcoming`} className="text-sm text-primary underline underline-offset-4">
          ← Reservations
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Booking <span className="font-mono">{r.code}</span>
        </h1>
        <p className="text-sm text-muted-foreground">
          {data.guestName} · {r.arrivalDate} → {r.departureDate} ({nights} night{nights === 1 ? "" : "s"}) · {data.categoryName}
          {data.roomCode ? `, room ${data.roomCode}` : ", room not assigned"}
        </p>
      </div>

      <Card>
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Status</dt>
            <dd>
              <Badge tone={r.status === "cancelled" ? "danger" : r.status === "checked_in" ? "success" : r.status === "no_show" ? "warning" : "info"}>
                {r.status.replace("_", " ")}
              </Badge>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Guests</dt>
            <dd>{r.adults}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Contact</dt>
            <dd>{[data.phone, data.email].filter(Boolean).join(" · ") || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Booked via</dt>
            <dd>
              {SOURCE_LABEL[r.source] ?? r.source}
              {r.externalRef && <span className="text-muted-foreground"> · {r.externalRef}</span>}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">Notes</dt>
            <dd>{r.notes ?? "—"}</dd>
          </div>
          {r.cancelReason && (
            <div className="sm:col-span-3">
              <dt className="text-xs text-muted-foreground">Reason</dt>
              <dd>{r.cancelReason}</dd>
            </div>
          )}
        </dl>
      </Card>

      {canCheckIn && (
        <Card>
          <h2 className="mb-1 text-sm font-semibold">Check in</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Only ready rooms are offered. Choosing another room type re-checks availability for the remaining nights.
          </p>
          <ActionForm action={checkInReservationAction.bind(null, prop.id, r.id)} className="flex flex-wrap items-end gap-2" aria-label="Check in booking">
            <label htmlFor="checkinRoomId" className="sr-only">
              Room
            </label>
            <Select name="checkinRoomId" defaultValue={assignedReady ? r.roomId! : ""} className="max-w-xs" required>
              <option value="" disabled>
                {ready.length ? "Choose a ready room…" : "No room is ready"}
              </option>
              {ready.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.roomCode} · {x.floorName}
                  {x.id === r.roomId ? " (assigned)" : ""}
                </option>
              ))}
            </Select>
            <Button type="submit" disabled={ready.length === 0}>
              Check in
            </Button>
          </ActionForm>
          {r.roomId && !assignedReady && (
            <p className="mt-2 text-xs text-warning">The assigned room {data.roomCode} isn&apos;t ready yet.</p>
          )}
        </Card>
      )}

      {canManage && options && (
        <>
          <Card>
            <h2 className="mb-4 text-sm font-semibold">Change booking</h2>
            <ReservationForm
              action={updateReservationAction.bind(null, prop.id, r.id)}
              categories={options.categories}
              rooms={options.rooms}
              defaults={{ ...r, guestName: data.guestName, phone: data.phone, email: data.email }}
              submitLabel="Save changes"
              editing
            />
          </Card>
          <Card className="space-y-3">
            <h2 className="text-sm font-semibold">Close booking</h2>
            <ActionForm action={closeReservationAction.bind(null, prop.id, r.id, "cancelled")} className="flex flex-wrap items-end gap-2" aria-label="Cancel booking">
              <label htmlFor="reason" className="sr-only">
                Reason
              </label>
              <Input name="reason" placeholder="Reason (optional)" maxLength={200} className="max-w-xs" />
              <ConfirmButton variant="secondary" confirmLabel="Confirm cancel">
                Cancel booking
              </ConfirmButton>
            </ActionForm>
            {r.arrivalDate <= today && (
              <ActionForm action={closeReservationAction.bind(null, prop.id, r.id, "no_show")} aria-label="Mark no-show">
                <ConfirmButton variant="secondary" confirmLabel="Confirm no-show">
                  Mark as no-show
                </ConfirmButton>
              </ActionForm>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
