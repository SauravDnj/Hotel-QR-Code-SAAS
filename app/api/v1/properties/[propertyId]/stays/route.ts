import { json, withApi } from "@/lib/api/v1";
import { listInHouse } from "@/modules/stays/service";

/** GET /api/v1/properties/:propertyId/stays — guests checked in now (room, name, dates). No contact details. */
export async function GET(req: Request, { params }: { params: Promise<{ propertyId: string }> }) {
  const { propertyId } = await params;
  return withApi(req, "stays:read", async ({ ctx }, db) => {
    const res = await listInHouse(db, ctx, propertyId);
    return json({
      data: res.stays.map((s) => ({
        stayId: s.stayId,
        roomId: s.roomId,
        roomCode: s.roomCode,
        guestName: s.guestName,
        adults: s.adults,
        checkInAt: s.checkInAt.toISOString(),
        expectedCheckoutAt: s.expectedCheckoutAt.toISOString(),
      })),
    });
  });
}
