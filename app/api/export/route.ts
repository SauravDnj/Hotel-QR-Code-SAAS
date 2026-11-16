import { getCurrentUser, requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { exportTenantData } from "@/modules/tenants/export";

/** Owner data export as a JSON download (tenant.manage). See modules/tenants/export.ts. */
export async function GET() {
  if (!(await getCurrentUser())) return new Response("Unauthorized", { status: 401 });
  const ctx = await requireTenantContext();
  try {
    const data = await exportTenantData(getDb(), ctx);
    const name = `hotel-export-${new Date().toISOString().slice(0, 10)}.json`;
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof AppError && err.code === "forbidden") return new Response("Forbidden", { status: 403 });
    if (err instanceof AppError && err.code === "rate_limited") return new Response("Too many exports, try again later", { status: 429 });
    throw err;
  }
}
