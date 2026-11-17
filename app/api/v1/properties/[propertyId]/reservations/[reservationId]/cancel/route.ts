import { json, readJson, withApi } from "@/lib/api/v1";
import { closeReservation, reservationEvent } from "@/modules/reservations/service";

/** POST /api/v1/properties/:propertyId/reservations/:reservationId/cancel — body { reason? }. Idempotent. */
export async function POST(req: Request, { params }: { params: Promise<{ propertyId: string; reservationId: string }> }) {
  const { propertyId, reservationId } = await params;
  return withApi(req, "reservations:write", async ({ ctx, keyId }, db) => {
    const body = await readJson(req);
    const row = await closeReservation(db, ctx, propertyId, reservationId, "cancelled", { reason: body.reason ? String(body.reason) : undefined }, {
      actor: { type: "api_key", keyId },
    });
    return json({ data: reservationEvent(row) });
  });
}
