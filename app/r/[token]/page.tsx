import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Clock, Mail, Phone, Wifi } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { clientIp } from "@/lib/auth/ip";
import { getDb } from "@/lib/db/client";
import { resolveGuestPortal } from "@/modules/guest-portal/public";
import { GuestShell, readableOn } from "../guest-shell";

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
    referrer: "no-referrer",
  };
}

export default async function GuestPortalPage({ params }: Props) {
  const result = await load((await params).token);
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

  const p = result.portal;
  const accent = p.accentColor ?? "#1f2a44";
  const onAccent = readableOn(accent);

  return (
    <GuestShell accent={accent}>
      <header
        className="relative overflow-hidden rounded-2xl px-5 pb-6 pt-8 text-center shadow-sm"
        style={{ background: accent, color: onAccent }}
      >
        {p.coverImageUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- hotel-hosted image, no optimiser configured
          <img src={p.coverImageUrl} alt="" className="absolute inset-0 size-full object-cover opacity-30" />
        )}
        <div className="relative">
          {p.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- hotel-hosted logo
            <img src={p.logoUrl} alt="" className="mx-auto mb-3 h-14 w-auto max-w-[60%] object-contain" />
          )}
          <p className="text-sm opacity-90">Welcome to</p>
          <h1 className="text-2xl font-semibold leading-tight">{p.hotelName}</h1>
          {p.city && <p className="text-sm opacity-90">{p.city}</p>}
          {p.roomLabel && (
            <p className="mt-3 inline-block rounded-full px-3 py-1 text-sm font-medium" style={{ background: `${onAccent}22` }}>
              Room {p.roomLabel}
            </p>
          )}
        </div>
      </header>

      {p.welcomeMessage && <p className="whitespace-pre-line px-1 text-center text-base">{p.welcomeMessage}</p>}

      {p.wifi && (
        <section aria-labelledby="wifi-h" className="rounded-2xl bg-surface p-5 shadow-sm">
          <h2 id="wifi-h" className="mb-3 flex items-center gap-2 text-base font-semibold">
            <Wifi className="size-5" aria-hidden /> Wi-Fi
          </h2>
          <dl className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">Network</dt>
                <dd className="break-all text-lg font-medium">{p.wifi.ssid}</dd>
              </div>
              <CopyButton value={p.wifi.ssid} label="Copy network name" />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">Password</dt>
                <dd className="break-all font-mono text-lg">{p.wifi.password ?? "No password needed"}</dd>
              </div>
              {p.wifi.password && <CopyButton value={p.wifi.password} label="Copy Wi-Fi password" />}
            </div>
          </dl>
          {p.wifi.note && <p className="mt-3 text-sm text-muted-foreground">{p.wifi.note}</p>}
        </section>
      )}

      {(p.receptionPhone || p.contactEmail) && (
        <section aria-label="Contact the hotel" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {p.receptionPhone && (
            <a
              href={`tel:${p.receptionPhone.replace(/[^+\d]/g, "")}`}
              className="flex min-h-14 items-center justify-center gap-2 rounded-2xl px-4 text-base font-semibold shadow-sm"
              style={{ background: accent, color: onAccent }}
            >
              <Phone className="size-5" aria-hidden /> Call reception
            </a>
          )}
          {p.contactEmail && (
            <a
              href={`mailto:${p.contactEmail}`}
              className="flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-border bg-surface px-4 text-base font-medium shadow-sm"
            >
              <Mail className="size-5" aria-hidden /> Email the hotel
            </a>
          )}
        </section>
      )}

      {(p.checkInTime || p.checkOutTime) && (
        <section aria-labelledby="times-h" className="rounded-2xl bg-surface p-5 shadow-sm">
          <h2 id="times-h" className="mb-3 flex items-center gap-2 text-base font-semibold">
            <Clock className="size-5" aria-hidden /> Stay times
          </h2>
          <dl className="grid grid-cols-2 gap-3 text-center">
            {p.checkInTime && (
              <div className="rounded-xl bg-surface-muted p-3">
                <dt className="text-xs text-muted-foreground">Check-in from</dt>
                <dd className="text-xl font-semibold tabular-nums">{p.checkInTime}</dd>
              </div>
            )}
            {p.checkOutTime && (
              <div className="rounded-xl bg-surface-muted p-3">
                <dt className="text-xs text-muted-foreground">Check-out by</dt>
                <dd className="text-xl font-semibold tabular-nums">{p.checkOutTime}</dd>
              </div>
            )}
          </dl>
        </section>
      )}

      {p.infoSections.length > 0 && (
        <section aria-labelledby="info-h" className="rounded-2xl bg-surface shadow-sm">
          <h2 id="info-h" className="px-5 pt-5 text-base font-semibold">
            Hotel information
          </h2>
          <div className="divide-y divide-border">
            {p.infoSections.map((s, i) => (
              <details key={i} className="group px-5 py-1">
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between text-base font-medium">
                  {s.title}
                  <span aria-hidden className="text-muted-foreground transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="whitespace-pre-line pb-4 text-sm text-muted-foreground">{s.body}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      <footer className="space-y-2 px-1 pb-6 text-center text-xs text-muted-foreground">
        {p.privacyNotice && <p className="whitespace-pre-line">{p.privacyNotice}</p>}
        <p>This page belongs to this room. It does not identify you or show any personal or booking details.</p>
      </footer>
    </GuestShell>
  );
}
