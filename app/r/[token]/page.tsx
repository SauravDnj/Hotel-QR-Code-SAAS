import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { clientIp } from "@/lib/auth/ip";
import { getDb } from "@/lib/db/client";
import { resolveGuestPortal } from "@/modules/guest-portal/public";
import { GuestShell } from "../guest-shell";
import { PortalView } from "../portal-view";

/**
 * Public guest portal for one room (QR_GUEST_PORTAL.md). The token in the URL is the only
 * input: tenant, property and room are resolved on the server. No login, no cookies, and
 * no guest or stay data. Never log `token`.
 */

// One resolution per request, shared by generateMetadata and the page (one scan counted).
const load = cache(async (token: string) => resolveGuestPortal(getDb(), token, { ip: clientIp(await headers()) }));

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const result = await load((await params).token);
  return {
    title: result.kind === "ok" ? { absolute: result.portal.hotelName } : { absolute: "Room services" },
    robots: { index: false, follow: false },
    referrer: "same-origin",
  };
}

export default async function GuestPortalPage({ params }: Props) {
  const { token } = await params;
  const result = await load(token);
  if (result.kind === "unavailable") notFound();
  if (result.kind === "rate_limited") {
    return (
      <GuestShell>
        <div className="rounded-2xl bg-surface p-6 text-center shadow-sm" role="alert">
          <h1 className="text-lg font-semibold">Please wait a moment</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            There have been a lot of requests from this network. Try again in a minute, or contact reception.
          </p>
        </div>
      </GuestShell>
    );
  }

  return (
    <main className="flex min-h-dvh flex-col">
      <PortalView portal={result.portal} services={result.services} token={token} />
    </main>
  );
}
