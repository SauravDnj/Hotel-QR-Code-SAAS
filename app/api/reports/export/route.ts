import { ZodError } from "zod";
import { getCurrentUser, requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { exportReportCsv } from "@/modules/reports/export";

/** Reports → "Download for Excel": ?type=requests|occupancy|revenue&property=…&from=…&to=… */
export async function GET(req: Request) {
  if (!(await getCurrentUser())) return new Response("Unauthorized", { status: 401 });
  const ctx = await requireTenantContext();
  const q = new URL(req.url).searchParams;
  try {
    const { filename, csv } = await exportReportCsv(getDb(), ctx, {
      type: q.get("type"),
      propertyId: q.get("property") ?? "",
      from: q.get("from") ?? undefined,
      to: q.get("to") ?? undefined,
    });
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    if (err instanceof ZodError) return new Response("Unknown report type", { status: 400 });
    if (err instanceof AppError) {
      const status = ({ forbidden: 403, not_found: 404, rate_limited: 429, plan_limit: 402, tenant_inactive: 403 } as Record<string, number>)[err.code] ?? 400;
      return new Response(err.message, { status });
    }
    throw err;
  }
}
