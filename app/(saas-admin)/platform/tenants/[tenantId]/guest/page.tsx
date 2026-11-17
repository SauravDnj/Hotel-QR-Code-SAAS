import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui/card";
import { requirePlatformAdmin } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { listGuestLinks } from "@/modules/platform/admin";

export const metadata: Metadata = { title: "Open as guest" };

export default async function GuestLinksPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const actor = await requirePlatformAdmin();
  const { tenantId } = await params;
  const data = await listGuestLinks(getDb(), actor, tenantId).catch((e) => {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  });

  return (
    <div className="space-y-6">
      <Link href={`/platform/tenants/${tenantId}`} className="text-sm text-primary underline underline-offset-4">
        ← {data.tenant.name}
      </Link>
      <PageHeader
        title="Open as a guest"
        description="Tap a room to open exactly what a guest sees after scanning that room's QR code. Opens in a new tab, no login needed."
      />
      <Alert tone="warning">
        Requests you send from a guest page go to the hotel&apos;s real staff inbox. Use “Something else” with a note like “Test from support” and let the
        hotel know. These links work like the printed QR codes: don&apos;t share them.
      </Alert>
      {data.properties.length === 0 ? (
        <EmptyState title="No rooms yet" description="This hotel hasn't added any rooms, so there are no guest pages to open." />
      ) : (
        data.properties.map((p) => (
          <Card key={p.id}>
            <h2 className="mb-3 font-semibold">
              {p.name} {!p.active && <span className="text-xs font-normal text-danger">(property archived: guest pages are off)</span>}
            </h2>
            <ul className="flex flex-wrap gap-2" aria-label={`Rooms of ${p.name}`}>
              {p.rooms.map((r) => (
                <li key={r.roomId}>
                  {r.path ? (
                    <a
                      href={r.path}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-10 items-center gap-1 rounded-ui border border-border bg-surface px-3 text-sm font-medium hover:bg-surface-muted"
                      aria-label={`Open guest page for room ${r.roomCode}`}
                    >
                      {r.roomCode} <ExternalLink className="size-3 text-muted-foreground" aria-hidden />
                    </a>
                  ) : (
                    <span className="inline-flex min-h-10 items-center rounded-ui border border-dashed border-border px-3 text-sm text-muted-foreground" title="No active QR code">
                      {r.roomCode} · no QR
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}
    </div>
  );
}
