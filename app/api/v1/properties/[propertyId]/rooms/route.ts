import { json, withApi } from "@/lib/api/v1";
import { listRooms } from "@/modules/rooms/rooms";

/** GET /api/v1/properties/:propertyId/rooms?page= — live rooms with their status. */
export async function GET(req: Request, { params }: { params: Promise<{ propertyId: string }> }) {
  const { propertyId } = await params;
  const page = new URL(req.url).searchParams.get("page") ?? "1";
  return withApi(req, "rooms:read", async ({ ctx }, db) => {
    const res = await listRooms(db, ctx, propertyId, { page, pageSize: "100" } as never);
    return json({
      data: res.items.map((r) => ({
        id: r.id,
        roomCode: r.roomCode,
        floor: r.floorName,
        roomType: r.categoryName,
        capacity: r.capacity,
        operationalStatus: r.operationalStatus,
        housekeepingStatus: r.housekeepingStatus,
      })),
      page: res.page,
      pageCount: res.pageCount,
      total: res.total,
    });
  });
}
