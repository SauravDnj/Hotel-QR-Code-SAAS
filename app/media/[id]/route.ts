import { getDb } from "@/lib/db/client";
import { getPublicMedia } from "@/modules/guest-portal/design";

/**
 * Hotel photos for the guest portal. A new upload always gets a new id, so responses are
 * immutable and cached by the CDN. Only JPEG/PNG/WebP are ever stored (magic-byte checked);
 * nosniff + a sandboxing CSP stop any file from being treated as a page.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const media = await getPublicMedia(getDb(), id);
  if (!media) return new Response("Not found", { status: 404, headers: { "Cache-Control": "public, max-age=60" } });
  return new Response(new Uint8Array(media.data), {
    headers: {
      "Content-Type": media.contentType,
      "Content-Length": String(media.data.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": "inline",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
