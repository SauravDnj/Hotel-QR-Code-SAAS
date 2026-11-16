import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PermissionDenied } from "@/components/permission-denied";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { qrSvgDataUri } from "@/lib/qr/render";
import { qrSheet } from "@/modules/qr/service";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Print QR codes" };

/**
 * Printable room QR sheet (A4/Letter, 3 per row). Outside the admin layout so the browser's
 * "Save as PDF" produces clean pages. Requires qr.view for this property.
 */
export default async function PrintQrPage({
  params,
  searchParams,
}: {
  params: Promise<{ propertyId: string }>;
  searchParams: Promise<{ floor?: string }>;
}) {
  const { propertyId } = await params;
  const { floor } = await searchParams;
  const ctx = await requireTenantContext();
  let sheet;
  try {
    sheet = await qrSheet(getDb(), ctx, propertyId, { floorId: floor });
  } catch (err) {
    if (err instanceof AppError && err.code === "not_found") notFound();
    if (err instanceof AppError && err.code === "forbidden") return <PermissionDenied />;
    throw err;
  }
  const cards = await Promise.all(sheet.items.map(async (i) => ({ ...i, img: await qrSvgDataUri(i.url) })));

  return (
    <main className="mx-auto max-w-5xl bg-white p-6 text-[#1c2331] print:max-w-none print:p-0">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-xl font-semibold">{sheet.property.name}: room QR codes</h1>
          <p className="text-sm text-[#5b6474]">
            {cards.length} code{cards.length === 1 ? "" : "s"}. Use your browser&apos;s print dialog, or “Save as PDF”.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/properties/${propertyId}/qr-codes`}
            className="inline-flex min-h-11 items-center rounded-ui border border-[#e2e2dd] px-4 text-sm"
          >
            Back
          </Link>
          <PrintButton />
        </div>
      </div>

      {cards.length === 0 ? (
        <p className="text-sm">No active QR codes to print. Create them on the QR codes page first.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 print:grid-cols-3 print:gap-3" aria-label="QR codes">
          {cards.map((c) => (
            <li
              key={c.url}
              className="flex break-inside-avoid flex-col items-center rounded-xl border border-dashed border-[#c9c9c3] p-4 text-center"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-[#5b6474]">{sheet.property.name}</p>
              <p className="mt-1 text-2xl font-semibold">Room {c.roomCode}</p>
              {/* eslint-disable-next-line @next/next/no-img-element -- inline SVG data URI for print */}
              <img src={c.img} alt={`QR code for room ${c.roomCode}`} className="my-2 aspect-square w-full max-w-48" />
              <p className="text-sm font-medium">Scan for Wi-Fi &amp; hotel services</p>
              <p className="text-xs text-[#5b6474]">Open your phone camera and point it at the code</p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
