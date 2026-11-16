import { ActionForm, ConfirmButton } from "@/components/action-form";
import { CopyButton } from "@/components/copy-button";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/card";
import { getDb } from "@/lib/db/client";
import { can, canWrite, type TenantContext } from "@/lib/permissions/authorize";
import { qrSvgDataUri } from "@/lib/qr/render";
import { formatDateTime } from "@/lib/utils";
import { getRoomQr } from "@/modules/qr/service";
import {
  deactivateRoomQrAction,
  issueRoomQrAction,
  reactivateRoomQrAction,
  rotateRoomQrAction,
} from "../../qr-actions";

const REASON_LABEL: Record<string, string> = {
  deactivated: "Deactivated",
  rotated: "Replaced",
  compromised: "Replaced (compromised)",
};

/** Room QR: preview, download, replace/deactivate and history. Server-rendered. */
export async function RoomQrCard({
  ctx,
  propertyId,
  roomId,
  archived,
  timezone,
}: {
  ctx: TenantContext;
  propertyId: string;
  roomId: string;
  archived: boolean;
  timezone: string;
}) {
  const scope = { propertyId };
  if (!can(ctx, "qr.view", scope)) return null;
  const { active, history, room } = await getRoomQr(getDb(), ctx, propertyId, roomId);
  const manage = canWrite(ctx, "qr.manage", scope) && !archived;
  const rotate = canWrite(ctx, "qr.rotate", scope) && !archived;
  const reactivatable = !active
    ? history.find((h) => h.status === "revoked" && h.revokeReason === "deactivated")
    : undefined;
  const download = `/api/properties/${propertyId}/rooms/${roomId}/qr`;
  const fileBase = `room-${room.roomCode.replace(/[^A-Za-z0-9-]/g, "_")}-qr`;
  const preview = active ? await qrSvgDataUri(active.url) : null;

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Room QR code</h3>
          <p className="text-xs text-muted-foreground">
            Opens the guest page for this room. It identifies the room, not the guest.
          </p>
        </div>
        {active ? <Badge tone="success">Active</Badge> : <Badge tone="warning">No active code</Badge>}
      </div>

      {active && preview ? (
        <div className="flex flex-col gap-5 sm:flex-row">
          {/* eslint-disable-next-line @next/next/no-img-element -- inline data URI, nothing to optimise */}
          <img
            src={preview}
            alt={`QR code for room ${room.roomCode}`}
            className="size-44 shrink-0 rounded-ui border border-border bg-white"
          />
          <div className="min-w-0 flex-1 space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 max-w-full truncate rounded bg-surface-muted px-2 py-1 text-xs" title="Guest link">
                {active.url}
              </code>
              <CopyButton value={active.url} label="Copy guest link" />
            </div>
            <p className="text-muted-foreground">
              Issued {formatDateTime(active.issuedAt, timezone)} · {active.scanCount} scan
              {active.scanCount === 1 ? "" : "s"}
              {active.lastScannedAt && <> · last {formatDateTime(active.lastScannedAt, timezone)}</>}
            </p>
            <div className="flex flex-wrap gap-2">
              <a
                className={buttonVariants({ variant: "secondary", size: "sm" })}
                href={`${download}?format=png`}
                download={`${fileBase}.png`}
              >
                Download PNG
              </a>
              <a
                className={buttonVariants({ variant: "secondary", size: "sm" })}
                href={`${download}?format=svg`}
                download={`${fileBase}.svg`}
              >
                Download SVG
              </a>
              <a className={buttonVariants({ variant: "ghost", size: "sm" })} href={active.url} target="_blank" rel="noreferrer">
                Open guest page ↗
              </a>
            </div>
            {(rotate || manage) && (
              <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                {rotate && (
                  <ActionForm action={rotateRoomQrAction.bind(null, propertyId, roomId)} aria-label="Replace QR code">
                    <ConfirmButton size="sm" variant="secondary" confirmLabel="Yes, replace code">
                      Replace code
                    </ConfirmButton>
                  </ActionForm>
                )}
                {manage && (
                  <ActionForm action={deactivateRoomQrAction.bind(null, propertyId, roomId)} aria-label="Deactivate QR code">
                    <ConfirmButton size="sm" variant="ghost" confirmLabel="Yes, deactivate">
                      Deactivate
                    </ConfirmButton>
                  </ActionForm>
                )}
              </div>
            )}
            {(rotate || manage) && (
              <p className="text-xs text-muted-foreground">
                <strong>Replace</strong> if a sticker was copied or misused: the old code stops working immediately.{" "}
                <strong>Deactivate</strong> pauses the same sticker (e.g. during renovation) and can be undone.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <p className="text-muted-foreground">Guests cannot open this room&apos;s page until a code is active.</p>
          {manage && reactivatable && (
            <ActionForm action={reactivateRoomQrAction.bind(null, propertyId, roomId, reactivatable.id)}>
              <Button type="submit" size="sm">
                Reactivate printed code
              </Button>
            </ActionForm>
          )}
          {manage && (
            <ActionForm action={issueRoomQrAction.bind(null, propertyId, roomId)}>
              <Button type="submit" size="sm" variant={reactivatable ? "secondary" : "primary"}>
                Create new QR code
              </Button>
            </ActionForm>
          )}
        </div>
      )}

      {history.length > (active ? 1 : 0) && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-muted-foreground">QR history ({history.length})</summary>
          <ol className="mt-2 space-y-1">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap justify-between gap-2 border-b border-border py-1 last:border-0">
                <span>
                  {h.status === "active" ? "Active" : (REASON_LABEL[h.revokeReason ?? ""] ?? h.status)} · {h.scanCount} scans
                </span>
                <span className="text-muted-foreground">
                  issued {formatDateTime(h.issuedAt, timezone)}
                  {h.revokedAt && <> · ended {formatDateTime(h.revokedAt, timezone)}</>}
                </span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </Card>
  );
}
