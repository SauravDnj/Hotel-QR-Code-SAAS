import type { Metadata } from "next";
import Link from "next/link";
import { PermissionDenied } from "@/components/permission-denied";
import { Card, EmptyState } from "@/components/ui/card";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { canWrite } from "@/lib/permissions/authorize";
import { listCategories } from "@/modules/rooms/categories";
import { listFloors } from "@/modules/rooms/floors";
import { bulkCreateRoomsAction, createRoomAction } from "../../structure-actions";
import { BulkRoomForm, RoomForm } from "../room-forms";

export const metadata: Metadata = { title: "Add rooms" };

export default async function NewRoomPage({ params }: { params: Promise<{ propertyId: string }> }) {
  const { propertyId } = await params;
  const ctx = await requireTenantContext();
  if (!canWrite(ctx, "room.manage", { propertyId })) return <PermissionDenied />;
  const [floors, categories] = await Promise.all([
    listFloors(getDb(), ctx, propertyId),
    listCategories(getDb(), ctx, propertyId),
  ]);
  if (!floors.length || !categories.length) {
    return <EmptyState title="Set up floors and room types first" description="Every room belongs to a floor and a room type." />;
  }
  const opts = {
    floors: floors.map((f) => ({ id: f.id, name: f.name })),
    categories: categories.map((c) => ({ id: c.id, name: c.name, capacity: c.capacity })),
  };
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Add rooms</h2>
        <Link href={`/properties/${propertyId}/rooms`} className="text-sm text-primary underline underline-offset-4">
          Back to rooms
        </Link>
      </div>
      <Card>
        <h3 className="mb-4 text-sm font-semibold">Add one room</h3>
        <RoomForm action={createRoomAction.bind(null, propertyId)} submitLabel="Create room" {...opts} />
      </Card>
      <BulkRoomForm action={bulkCreateRoomsAction.bind(null, propertyId)} {...opts} />
    </div>
  );
}
