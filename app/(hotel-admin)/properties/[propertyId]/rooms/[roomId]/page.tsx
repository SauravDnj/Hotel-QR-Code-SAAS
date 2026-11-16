import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, ConfirmButton } from "@/components/action-form";
import { HOUSEKEEPING_LABELS, HousekeepingBadge, OPERATIONAL_LABELS, OperationalBadge } from "@/components/room-status";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, EmptyState } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { canWrite } from "@/lib/permissions/authorize";
import { formatDateTime } from "@/lib/utils";
import { listCategories } from "@/modules/rooms/categories";
import { listFloors } from "@/modules/rooms/floors";
import { getRoom, HOUSEKEEPING_STATUSES, listRoomHistory, OPERATIONAL_STATUSES } from "@/modules/rooms/rooms";
import { archiveRoomAction, changeRoomStatusAction, updateRoomAction } from "../../structure-actions";
import { RoomForm } from "../room-forms";
import { RoomQrCard } from "./room-qr-card";
import { currentStay } from "@/modules/stays/service";

export const metadata: Metadata = { title: "Room" };

const label = (dimension: string, status: string | null) =>
  !status
    ? "—"
    : dimension === "operational"
      ? (OPERATIONAL_LABELS[status as keyof typeof OPERATIONAL_LABELS]?.label ?? status)
      : (HOUSEKEEPING_LABELS[status as keyof typeof HOUSEKEEPING_LABELS]?.label ?? status);

export default async function RoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ propertyId: string; roomId: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { propertyId, roomId } = await params;
  const { created } = await searchParams;
  const ctx = await requireTenantContext();
  const db = getDb();

  let room;
  try {
    room = await getRoom(db, ctx, propertyId, roomId);
  } catch (err) {
    if (err instanceof AppError && (err.code === "not_found" || err.code === "forbidden")) notFound();
    throw err;
  }
  const [floors, categories, history, stay] = await Promise.all([
    listFloors(db, ctx, propertyId),
    listCategories(db, ctx, propertyId),
    listRoomHistory(db, ctx, propertyId, room.id),
    currentStay(db, ctx, propertyId, room.id),
  ]);
  const scope = { propertyId };
  const manage = canWrite(ctx, "room.manage", scope) && !room.archivedAt;
  const housekeeping = canWrite(ctx, "housekeeping.manage", scope) && !room.archivedAt;
  const statusAction = changeRoomStatusAction.bind(null, propertyId, room.id);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href={`/properties/${propertyId}/rooms`} className="text-sm text-primary underline underline-offset-4">
            ← All rooms
          </Link>
          <h2 className="mt-1 text-2xl font-semibold">Room {room.roomCode}</h2>
          <p className="text-sm text-muted-foreground">
            {room.floorName} · {room.categoryName} · up to {room.capacity ?? room.categoryCapacity} guests
          </p>
        </div>
        <div className="flex gap-2">
          <Badge tone={stay ? "info" : "success"}>{stay ? "Occupied" : "Vacant"}</Badge>
          <OperationalBadge status={room.operationalStatus} />
          <HousekeepingBadge status={room.housekeepingStatus} />
        </div>
      </div>

      {created && <Alert tone="success">Room created.</Alert>}
      {stay && (
        <Alert tone="info">
          Occupied{stay.guestName && <> by {stay.guestName}</>} since {formatDateTime(stay.checkInAt, room.property.timezone)}, due out{" "}
          {formatDateTime(stay.expectedCheckoutAt, room.property.timezone)}.{" "}
          <Link href={`/front-desk?property=${propertyId}`} className="underline underline-offset-4">
            Front desk
          </Link>
        </Alert>
      )}
      {room.archivedAt && <Alert tone="warning">This room is archived. Restore it to edit or change status.</Alert>}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h3 className="text-sm font-semibold">Operational status</h3>
          <p className="mb-3 text-xs text-muted-foreground">Whether the room can be sold or used.</p>
          {manage ? (
            <ActionForm action={statusAction} className="flex flex-wrap items-center gap-2" aria-label="Operational status">
              <input type="hidden" name="dimension" value="operational" />
              <Select name="status" defaultValue={room.operationalStatus} aria-label="Operational status" className="w-44">
                {OPERATIONAL_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {OPERATIONAL_LABELS[s].label}
                  </option>
                ))}
              </Select>
              <Input name="note" placeholder="Reason (optional)" aria-label="Reason" className="w-48" />
              <Button type="submit" size="sm">
                Update
              </Button>
            </ActionForm>
          ) : (
            <OperationalBadge status={room.operationalStatus} />
          )}
        </Card>
        <Card>
          <h3 className="text-sm font-semibold">Housekeeping status</h3>
          <p className="mb-3 text-xs text-muted-foreground">Cleanliness, separate from occupancy and service status.</p>
          {housekeeping ? (
            <ActionForm action={statusAction} className="flex flex-wrap items-center gap-2" aria-label="Housekeeping status">
              <input type="hidden" name="dimension" value="housekeeping" />
              <Select name="status" defaultValue={room.housekeepingStatus} aria-label="Housekeeping status" className="w-44">
                {HOUSEKEEPING_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {HOUSEKEEPING_LABELS[s].label}
                  </option>
                ))}
              </Select>
              <Input name="note" placeholder="Note (optional)" aria-label="Note" className="w-48" />
              <Button type="submit" size="sm">
                Update
              </Button>
            </ActionForm>
          ) : (
            <HousekeepingBadge status={room.housekeepingStatus} />
          )}
        </Card>
      </div>

      <RoomQrCard
        ctx={ctx}
        propertyId={propertyId}
        roomId={room.id}
        archived={Boolean(room.archivedAt)}
        timezone={room.property.timezone}
      />

      <Card>
        <h3 className="mb-4 text-sm font-semibold">Room details</h3>
        <RoomForm
          action={updateRoomAction.bind(null, propertyId, room.id)}
          floors={floors.map((f) => ({ id: f.id, name: f.name }))}
          categories={categories.map((c) => ({ id: c.id, name: c.name, capacity: c.capacity }))}
          initial={{
            roomCode: room.roomCode,
            floorId: room.floorId,
            categoryId: room.categoryId,
            capacity: room.capacity === null ? "" : String(room.capacity),
            notes: room.notes,
          }}
          submitLabel="Save room"
          readOnly={!manage}
        />
      </Card>

      <Card>
        <h3 className="mb-3 text-sm font-semibold">Status history</h3>
        {history.length === 0 ? (
          <EmptyState title="No status changes yet" description="Changes to operational or housekeeping status appear here." />
        ) : (
          <ol className="space-y-2 text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap justify-between gap-2 border-b border-border pb-2 last:border-0">
                <span>
                  <span className="font-medium capitalize">{h.dimension}</span>: {label(h.dimension, h.fromStatus)} →{" "}
                  {label(h.dimension, h.toStatus)}
                  {h.note && <span className="text-muted-foreground"> · {h.note}</span>}
                </span>
                <span className="text-muted-foreground">
                  {h.actorName ?? "System"} · {formatDateTime(h.changedAt, room.property.timezone)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Card>

      {canWrite(ctx, "room.manage", scope) && (
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">{room.archivedAt ? "Restore room" : "Archive room"}</h3>
            <p className="text-xs text-muted-foreground">
              Archived rooms are hidden from lists and cannot receive requests. History is kept.
            </p>
          </div>
          <ActionForm action={archiveRoomAction.bind(null, propertyId, room.id, !room.archivedAt)}>
            {room.archivedAt ? (
              <Button type="submit" variant="secondary">
                Restore room
              </Button>
            ) : (
              <ConfirmButton variant="secondary" confirmLabel="Yes, archive">
                Archive room
              </ConfirmButton>
            )}
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
