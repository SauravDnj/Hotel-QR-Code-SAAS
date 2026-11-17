import { json, readJson, withApi } from "@/lib/api/v1";
import { postChargeToRoom } from "@/modules/ordering/folio";

/**
 * POST /api/v1/properties/:propertyId/folio-charges — POS posting to the guest in a room.
 * Body: { roomCode, description, amountMinor (integer, e.g. paise; negative = refund), externalRef }.
 * Idempotent on externalRef: a retry returns the original charge with 200.
 */
export async function POST(req: Request, { params }: { params: Promise<{ propertyId: string }> }) {
  const { propertyId } = await params;
  return withApi(req, "folio:write", async ({ ctx, keyId }, db) => {
    const body = await readJson(req);
    const res = await postChargeToRoom(db, ctx, propertyId, body, { userId: null, actorType: "api_key", apiKeyId: keyId });
    const c = res.charge;
    return json(
      { data: { id: c.id, stayId: c.stayId, description: c.description, amountMinor: c.amountMinor, externalRef: c.externalRef, createdAt: c.createdAt }, duplicate: res.duplicate },
      res.duplicate ? 200 : 201,
    );
  });
}
