import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { PermissionDenied } from "@/components/permission-denied";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge, Card, EmptyState } from "@/components/ui/card";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { loadOr404 } from "@/lib/page-errors";
import { can, canWrite } from "@/lib/permissions/authorize";
import { cn, formatDateTime } from "@/lib/utils";
import { listPropertyQr } from "@/modules/qr/service";
import { listFloors } from "@/modules/rooms/floors";
import { issueMissingQrAction } from "../qr-actions";
import { AuditStartLink } from "./audit-start-link";

export const metadata: Metadata = { title: "QR codes" };

export default async function QrCodesPage({
  params,
  searchParams,
}: {
  params: Promise<{ propertyId: string }>;
  searchParams: Promise<{ floor?: string; audit?: string }>;
}) {
  const { propertyId } = await params;
  const { floor, audit } = await searchParams;
  const ctx = await requireTenantContext();
  if (!can(ctx, "qr.view", { propertyId })) return <PermissionDenied />;
  const db = getDb();
  const [{ property, items }, floors] = await loadOr404(() =>
    Promise.all([listPropertyQr(db, ctx, propertyId, { floorId: floor }), listFloors(db, ctx, propertyId)]),
  );
  const floorId = floors.some((f) => f.id === floor) ? floor : undefined;
  const missing = items.filter((i) => !i.qrId).length;
  const manage = canWrite(ctx, "qr.manage", { propertyId });
  const base = `/properties/${propertyId}`;
  const printHref = `/print/properties/${propertyId}/qr${floorId ? `?floor=${floorId}` : ""}`;
  // Room-by-room audit: every active code scanned since the audit started counts as verified.
  const auditStart = audit && !Number.isNaN(Date.parse(audit)) ? new Date(audit) : null;
  const verified = auditStart ? items.filter((i) => i.qrId && i.lastScannedAt && i.lastScannedAt >= auditStart).length : 0;
  const auditable = items.filter((i) => i.qrId).length;
  const floorQs = floorId ? `floor=${floorId}&` : "";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">QR codes</h2>
          <p className="text-sm text-muted-foreground">
            One code per room. Guests scan it to open this hotel&apos;s page for that room. Codes never contain guest
            details or internal ids.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {manage && missing > 0 && (
            <ActionForm action={issueMissingQrAction.bind(null, propertyId)}>
              {floorId && <input type="hidden" name="floorId" value={floorId} />}
              <Button type="submit">
                Create {missing} missing code{missing === 1 ? "" : "s"}
              </Button>
            </ActionForm>
          )}
          {items.length > 0 && (
            <Link href={printHref} className={buttonVariants({ variant: "secondary" })} target="_blank">
              Print sheet{floorId ? " for this floor" : ""}
            </Link>
          )}
        </div>
      </div>

      <div className="rounded-ui border border-border bg-surface p-4 text-sm">
        {auditStart ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p role="status">
              <strong>
                Audit: {verified} of {auditable} codes verified
              </strong>{" "}
              since {formatDateTime(auditStart, property.timezone)}. Scan each room&apos;s sticker with a phone; rooms turn green
              when the scan arrives (reload to update).
            </p>
            <Link href={`${base}/qr-codes${floorId ? `?floor=${floorId}` : ""}`} className="text-primary underline underline-offset-4">
              End audit
            </Link>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-muted-foreground">
              Before launch, walk every room and scan its printed sticker to prove each one opens the right room.
            </p>
            <AuditStartLink href={`${base}/qr-codes?${floorQs}audit=`} />
          </div>
        )}
      </div>

      {floors.length > 0 && (
        <nav aria-label="Filter by floor" className="flex flex-wrap gap-2 text-sm">
          {[{ id: undefined, name: "All floors" }, ...floors].map((f) => (
            <Link
              key={f.id ?? "all"}
              href={f.id ? `${base}/qr-codes?floor=${f.id}` : `${base}/qr-codes`}
              aria-current={f.id === floorId ? "page" : undefined}
              className={cn(
                "rounded-full border border-border px-3 py-1.5",
                f.id === floorId ? "bg-primary text-primary-foreground" : "bg-surface hover:bg-surface-muted",
              )}
            >
              {f.name}
            </Link>
          ))}
        </nav>
      )}

      {items.length === 0 ? (
        <EmptyState
          title="No rooms yet"
          description="Add rooms first; each new room gets its QR code automatically."
          action={
            <Link href={`${base}/rooms`} className={buttonVariants()}>
              Go to rooms
            </Link>
          }
        />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Room</th>
                <th className="px-4 py-3 font-medium">Floor</th>
                <th className="px-4 py-3 font-medium">QR</th>
                <th className="px-4 py-3 font-medium">Scans</th>
                <th className="px-4 py-3 font-medium">Last scanned</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.roomId} className="border-b border-border last:border-0">
                  <td className="px-4 py-2">
                    <Link href={`${base}/rooms/${i.roomId}`} className="font-medium text-primary underline underline-offset-4">
                      {i.roomCode}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{i.floorName}</td>
                  <td className="px-4 py-2">
                    {i.qrId ? <Badge tone="success">Active</Badge> : <Badge tone="warning">None</Badge>}
                    {auditStart && i.qrId && (
                      <span className="ml-2">
                        {i.lastScannedAt && i.lastScannedAt >= auditStart ? (
                          <Badge tone="success">Verified</Badge>
                        ) : (
                          <Badge tone="warning">Not scanned yet</Badge>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 tabular-nums">{i.qrId ? i.scanCount : "—"}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {i.lastScannedAt ? formatDateTime(i.lastScannedAt, property.timezone) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
