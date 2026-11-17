import { json, withApi } from "@/lib/api/v1";
import { listProperties } from "@/modules/properties/service";

/** GET /api/v1/properties — properties this key can see. */
export async function GET(req: Request) {
  return withApi(req, null, async ({ ctx }, db) => {
    const rows = await listProperties(db, ctx);
    return json({
      data: rows.map((p) => ({ id: p.id, name: p.name, timezone: p.timezone, currency: p.currency, status: p.status, city: p.city })),
    });
  });
}
