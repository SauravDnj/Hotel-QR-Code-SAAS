import { json, readJson, withApi } from "@/lib/api/v1";
import { createReservation, listReservations, reservationEvent, type ReservationView } from "@/modules/reservations/service";

const VIEWS: ReservationView[] = ["upcoming", "arrivals", "in_house", "closed"];

/** GET /api/v1/properties/:propertyId/reservations?view=upcoming|arrivals|in_house|closed&q= */
export async function GET(req: Request, { params }: { params: Promise<{ propertyId: string }> }) {
  const { propertyId } = await params;
  const sp = new URL(req.url).searchParams;
  const view = VIEWS.find((v) => v === sp.get("view")) ?? "upcoming";
  return withApi(req, "reservations:read", async ({ ctx }, db) => {
    const res = await listReservations(db, ctx, propertyId, { view, q: sp.get("q") ?? undefined, limit: 500 });
    return json({
      data: res.reservations.map((r) => ({
        id: r.id,
        code: r.code,
        status: r.status,
        arrivalDate: r.arrivalDate,
        departureDate: r.departureDate,
        nights: r.nights,
        adults: r.adults,
        roomTypeId: r.categoryId,
        roomType: r.categoryName,
        roomId: r.roomId,
        roomCode: r.roomCode,
        source: r.source,
        externalRef: r.externalRef,
        guest: { name: r.guestName, phone: r.phone, email: r.email },
      })),
    });
  });
}

/**
 * POST /api/v1/properties/:propertyId/reservations — create a booking. Idempotent when
 * `externalRef` is given: repeating the call returns the original booking with 200.
 * Body: { roomTypeId, roomId?, guestName, phone?, email?, arrivalDate, departureDate, adults, source?, externalRef?, notes? }
 */
export async function POST(req: Request, { params }: { params: Promise<{ propertyId: string }> }) {
  const { propertyId } = await params;
  return withApi(req, "reservations:write", async ({ ctx, keyId }, db) => {
    const body = await readJson(req);
    const source = body.source === "ota" ? "ota" : "api";
    const res = await createReservation(
      db,
      ctx,
      propertyId,
      {
        categoryId: String(body.roomTypeId ?? ""),
        roomId: body.roomId ? String(body.roomId) : undefined,
        guestName: String(body.guestName ?? ""),
        phone: body.phone ? String(body.phone) : undefined,
        email: body.email ? String(body.email) : undefined,
        arrivalDate: String(body.arrivalDate ?? ""),
        departureDate: String(body.departureDate ?? ""),
        adults: (body.adults ?? 1) as number,
        source,
        externalRef: body.externalRef ? String(body.externalRef) : undefined,
        notes: body.notes ? String(body.notes) : undefined,
      },
      { actor: { type: "api_key", keyId } },
    );
    return json({ data: reservationEvent(res.reservation), duplicate: res.duplicate }, res.duplicate ? 200 : 201);
  });
}
