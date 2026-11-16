import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { qrPng, qrSvg } from "@/lib/qr/render";
import { getRoomQr } from "@/modules/qr/service";

/**
 * Download the room's active QR as PNG (print shops) or SVG (scalable). Requires qr.view
 * in the caller's own tenant; another tenant's ids are a plain 404.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ propertyId: string; roomId: string }> },
) {
  const { propertyId, roomId } = await params;
  const ctx = await requireTenantContext();
  let qr;
  try {
    qr = await getRoomQr(getDb(), ctx, propertyId, roomId);
  } catch (err) {
    if (err instanceof AppError && (err.code === "not_found" || err.code === "forbidden")) {
      return new Response("Not found", { status: 404 });
    }
    throw err;
  }
  if (!qr.active) return new Response("This room has no active QR code.", { status: 404 });

  const format = new URL(request.url).searchParams.get("format") === "svg" ? "svg" : "png";
  const name = `room-${qr.room.roomCode.replace(/[^A-Za-z0-9-]/g, "_")}-qr.${format}`;
  const headers = {
    "Content-Disposition": `attachment; filename="${name}"`,
    // The image encodes a live bearer link: never cache it in shared caches.
    "Cache-Control": "private, no-store",
  };
  if (format === "svg") {
    return new Response(await qrSvg(qr.active.url), { headers: { ...headers, "Content-Type": "image/svg+xml" } });
  }
  const png = await qrPng(qr.active.url);
  return new Response(new Uint8Array(png), { headers: { ...headers, "Content-Type": "image/png" } });
}
