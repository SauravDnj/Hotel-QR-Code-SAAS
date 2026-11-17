import { json, withApi } from "@/lib/api/v1";
import { availability } from "@/modules/reservations/service";

/** GET /api/v1/properties/:propertyId/availability?from=YYYY-MM-DD&to=YYYY-MM-DD — free rooms per type per night. */
export async function GET(req: Request, { params }: { params: Promise<{ propertyId: string }> }) {
  const { propertyId } = await params;
  const sp = new URL(req.url).searchParams;
  return withApi(req, "reservations:read", async ({ ctx }, db) => {
    const res = await availability(db, ctx, propertyId, sp.get("from") ?? "", sp.get("to") ?? "");
    return json({ data: { from: res.from, to: res.to, roomTypes: res.categories } });
  });
}
