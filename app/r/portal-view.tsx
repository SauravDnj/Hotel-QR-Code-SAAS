import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, Clock, Mail, Phone, Wifi } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { ServiceIcon } from "@/components/service-icon";
import { cn } from "@/lib/utils";
import type { GuestPortal, GuestService } from "@/modules/guest-portal/public";
import { MyRequests } from "./my-requests";
import { readableOn } from "./readable";

/**
 * The guest page body for every design template. Pure presentation (no server-only code), so
 * the admin Design page renders the SAME component as a live preview.
 * `token` null = preview: links are inert and device-only widgets are hidden.
 */

export type PortalServiceView = Pick<GuestService, "id" | "name" | "icon" | "availableNow" | "availableFrom" | "availableTo"> & {
  description?: string | null;
  imageUrl: string | null;
};

export interface PortalViewProps {
  portal: GuestPortal;
  services: PortalServiceView[];
  token: string | null;
}

const SERIF = 'Georgia, Cambria, "Times New Roman", serif';

export function PortalView({ portal: p, services, token }: PortalViewProps) {
  const accent = p.accentColor ?? "#1f2a44";
  const onAccent = readableOn(accent);
  const theme = p.theme;
  const pageStyle: CSSProperties = {
    ...(p.backgroundColor ? { background: p.backgroundColor, color: readableOn(p.backgroundColor) } : {}),
    ...(p.fontStyle === "serif" || theme === "elegant" ? { fontFamily: SERIF } : {}),
    ["--accent" as string]: accent,
  };
  const card = cn(
    "bg-surface text-foreground",
    theme === "elegant" ? "rounded-none border border-border" : theme === "minimal" ? "rounded-xl border border-border" : "rounded-2xl shadow-sm",
  );
  const href = (serviceId: string) => (token ? `/r/${token}/request/${serviceId}` : "#");

  return (
    <div className="min-h-full flex-1" style={pageStyle}>
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-4">
        <Header p={p} accent={accent} onAccent={onAccent} />

        {p.welcomeMessage && (
          <p className={cn("whitespace-pre-line px-1 text-base", theme === "minimal" ? "text-left" : "text-center", theme === "elegant" && "italic")}>
            {p.welcomeMessage}
          </p>
        )}

        {theme === "photo" && p.gallery.length > 0 && <Gallery items={p.gallery} card={card} preview={!token} />}

        {services.length > 0 && (
          <section aria-labelledby="services-h">
            <h2 id="services-h" className={cn("mb-3 px-1 text-base font-semibold", theme === "elegant" && "text-center text-lg tracking-wide")}>
              How can we help?
            </h2>
            <Services theme={theme} services={services} accent={accent} onAccent={onAccent} card={card} href={href} />
            {token && <MyRequests />}
          </section>
        )}

        {theme !== "photo" && p.gallery.length > 0 && <Gallery items={p.gallery} card={card} preview={!token} />}

        {p.wifi && (
          <section aria-labelledby="wifi-h" className={cn(card, "p-5")}>
            <h2 id="wifi-h" className="mb-3 flex items-center gap-2 text-base font-semibold">
              <Wifi className="size-5" aria-hidden style={{ color: accent }} /> Wi-Fi
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
                href={token ? `tel:${p.receptionPhone.replace(/[^+\d]/g, "")}` : undefined}
                className={cn(
                  "flex min-h-14 items-center justify-center gap-2 px-4 text-base font-semibold shadow-sm",
                  theme === "elegant" ? "rounded-none" : theme === "minimal" ? "rounded-xl" : "rounded-2xl",
                )}
                style={{ background: accent, color: onAccent }}
              >
                <Phone className="size-5" aria-hidden /> Call reception
              </a>
            )}
            {p.contactEmail && (
              <a href={token ? `mailto:${p.contactEmail}` : undefined} className={cn(card, "flex min-h-14 items-center justify-center gap-2 px-4 text-base font-medium")}>
                <Mail className="size-5" aria-hidden /> Email the hotel
              </a>
            )}
          </section>
        )}

        {(p.checkInTime || p.checkOutTime) && (
          <section aria-labelledby="times-h" className={cn(card, "p-5")}>
            <h2 id="times-h" className="mb-3 flex items-center gap-2 text-base font-semibold">
              <Clock className="size-5" aria-hidden style={{ color: accent }} /> Stay times
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
          <section aria-labelledby="info-h" className={card}>
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

        <footer className="space-y-2 px-1 pb-6 text-center text-xs opacity-70">
          {p.privacyNotice && <p className="whitespace-pre-line">{p.privacyNotice}</p>}
          <p>This page belongs to this room. It does not identify you or show any personal or booking details.</p>
        </footer>
      </div>
    </div>
  );
}

function Img({ src, className }: { src: string; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- hotel photos served from /media (already resized)
  return <img src={src} alt="" className={className} loading="lazy" decoding="async" />;
}

function RoomChip({ label, style }: { label: string; style?: CSSProperties }) {
  return (
    <p className="mt-3 inline-block rounded-full px-3 py-1 text-sm font-medium" style={style}>
      Room {label}
    </p>
  );
}

function Header({ p, accent, onAccent }: { p: GuestPortal; accent: string; onAccent: string }) {
  if (p.theme === "photo") {
    return (
      <header className="relative min-h-60 overflow-hidden rounded-2xl text-white shadow-sm" style={p.coverImageUrl ? undefined : { background: accent, color: onAccent }}>
        {p.coverImageUrl && <Img src={p.coverImageUrl} className="absolute inset-0 size-full object-cover" />}
        <div className={cn("absolute inset-0", p.coverImageUrl && "bg-gradient-to-t from-black/75 via-black/25 to-transparent")} />
        <div className="relative flex min-h-60 flex-col justify-end p-5">
          {p.logoUrl && <Img src={p.logoUrl} className="mb-3 h-12 w-auto max-w-[50%] object-contain object-left" />}
          <p className="text-sm opacity-90">Welcome to</p>
          <h1 className="text-3xl font-semibold leading-tight">{p.hotelName}</h1>
          {p.city && <p className="text-sm opacity-90">{p.city}</p>}
          {p.roomLabel && (
            <div>
              <RoomChip label={p.roomLabel} style={p.coverImageUrl ? { background: accent, color: onAccent } : { background: `${onAccent}22` }} />
            </div>
          )}
        </div>
      </header>
    );
  }
  if (p.theme === "elegant") {
    return (
      <header className="overflow-hidden border border-border bg-surface text-center text-foreground">
        {p.coverImageUrl && <Img src={p.coverImageUrl} className="h-40 w-full object-cover" />}
        <div className="px-5 pb-6 pt-6">
          {p.logoUrl && <Img src={p.logoUrl} className="mx-auto mb-3 h-14 w-auto max-w-[60%] object-contain" />}
          <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Welcome to</p>
          <h1 className="mt-1 text-3xl leading-tight tracking-wide">{p.hotelName}</h1>
          <div className="mx-auto my-3 h-px w-16" style={{ background: accent }} />
          {p.city && <p className="text-sm text-muted-foreground">{p.city}</p>}
          {p.roomLabel && <p className="mt-2 text-sm uppercase tracking-[0.2em]" style={{ color: accent }}>Room {p.roomLabel}</p>}
        </div>
      </header>
    );
  }
  if (p.theme === "minimal") {
    return (
      <header className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4 text-foreground">
        {p.logoUrl ? (
          <Img src={p.logoUrl} className="size-12 shrink-0 rounded-lg object-contain" />
        ) : (
          <span className="flex size-12 shrink-0 items-center justify-center rounded-lg text-lg font-semibold" style={{ background: accent, color: onAccent }}>
            {p.hotelName.slice(0, 1)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="line-clamp-2 text-lg font-semibold leading-tight">{p.hotelName}</h1>
          {p.city && <p className="truncate text-xs text-muted-foreground">{p.city}</p>}
        </div>
        {p.roomLabel && (
          <span className="shrink-0 rounded-full px-3 py-1 text-sm font-medium" style={{ background: accent, color: onAccent }}>
            {p.roomLabel}
          </span>
        )}
      </header>
    );
  }
  return (
    <header className="relative overflow-hidden rounded-2xl px-5 pb-6 pt-8 text-center shadow-sm" style={{ background: accent, color: onAccent }}>
      {p.coverImageUrl && <Img src={p.coverImageUrl} className="absolute inset-0 size-full object-cover opacity-30" />}
      <div className="relative">
        {p.logoUrl && <Img src={p.logoUrl} className="mx-auto mb-3 h-14 w-auto max-w-[60%] object-contain" />}
        <p className="text-sm opacity-90">Welcome to</p>
        <h1 className="text-2xl font-semibold leading-tight">{p.hotelName}</h1>
        {p.city && <p className="text-sm opacity-90">{p.city}</p>}
        {p.roomLabel && <RoomChip label={p.roomLabel} style={{ background: `${onAccent}22` }} />}
      </div>
    </header>
  );
}

function Services({
  theme,
  services,
  accent,
  onAccent,
  card,
  href,
}: {
  theme: GuestPortal["theme"];
  services: PortalServiceView[];
  accent: string;
  onAccent: string;
  card: string;
  href: (id: string) => string;
}) {
  const closed = (s: PortalServiceView) => (
    <span className="text-xs text-muted-foreground">
      Available {s.availableFrom}–{s.availableTo}
    </span>
  );

  if (theme === "photo") {
    return (
      <ul className="grid grid-cols-2 gap-3">
        {services.map((s) => (
          <li key={s.id}>
            <Tile s={s} href={href} className="relative flex aspect-[4/3] overflow-hidden rounded-2xl shadow-sm">
              {s.imageUrl ? (
                <Img src={s.imageUrl} className="absolute inset-0 size-full object-cover" />
              ) : (
                <span className="absolute inset-0 p-3" style={{ background: accent, color: onAccent }}>
                  <ServiceIcon name={s.icon} className="size-8 opacity-90" />
                </span>
              )}
              {s.imageUrl && <span className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />}
              <span className="relative mt-auto p-3 text-base font-semibold leading-tight" style={{ color: s.imageUrl ? "#ffffff" : onAccent }}>
                {s.name}
                {!s.availableNow && (
                  <span className="block text-xs font-normal opacity-80">
                    {s.availableFrom}–{s.availableTo}
                  </span>
                )}
              </span>
            </Tile>
          </li>
        ))}
      </ul>
    );
  }
  if (theme === "elegant") {
    return (
      <ul className={cn(card, "divide-y divide-border")}>
        {services.map((s) => (
          <li key={s.id}>
            <Tile s={s} href={href} className="flex min-h-16 items-center gap-4 px-4 py-3">
              {s.imageUrl ? (
                <Img src={s.imageUrl} className="size-12 shrink-0 rounded-full object-cover" />
              ) : (
                <span className="flex size-12 shrink-0 items-center justify-center rounded-full border" style={{ borderColor: accent, color: accent }}>
                  <ServiceIcon name={s.icon} className="size-5" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-base">{s.name}</span>
                {!s.availableNow ? closed(s) : s.description && <span className="block truncate text-xs text-muted-foreground">{s.description}</span>}
              </span>
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
            </Tile>
          </li>
        ))}
      </ul>
    );
  }
  if (theme === "minimal") {
    return (
      <ul className="grid grid-cols-3 gap-2">
        {services.map((s) => (
          <li key={s.id}>
            <Tile s={s} href={href} className={cn(card, "flex min-h-24 flex-col items-center justify-center gap-2 p-2 text-center")}>
              <ServiceIcon name={s.icon} className="size-6" style={{ color: accent }} />
              <span className="text-xs font-medium leading-tight">{s.name}</span>
              {!s.availableNow && <span className="text-[10px] text-muted-foreground">{s.availableFrom}–{s.availableTo}</span>}
            </Tile>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="grid grid-cols-2 gap-3">
      {services.map((s) => (
        <li key={s.id}>
          <Tile s={s} href={href} className={cn(card, "flex min-h-28 flex-col items-start justify-between gap-2 overflow-hidden p-4")}>
            {s.imageUrl ? (
              <Img src={s.imageUrl} className="-mx-4 -mt-4 mb-1 h-20 w-[calc(100%+2rem)] max-w-none object-cover" />
            ) : (
              <span className="rounded-full p-2" style={{ background: `${accent}1a`, color: accent }}>
                <ServiceIcon name={s.icon} className="size-6" />
              </span>
            )}
            <span className="text-base font-semibold leading-tight">{s.name}</span>
            {!s.availableNow && closed(s)}
          </Tile>
        </li>
      ))}
    </ul>
  );
}

function Gallery({ items, card, preview }: { items: GuestPortal["gallery"]; card: string; preview: boolean }) {
  return (
    <section aria-labelledby="gallery-h">
      <h2 id="gallery-h" className="mb-3 px-1 text-base font-semibold">
        Explore the hotel
      </h2>
      <ul className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2" aria-label="Hotel photos">
        {items.map((g, i) => (
          <li key={g.url + i} className={cn(card, "w-64 shrink-0 snap-start overflow-hidden")}>
            <a href={preview ? undefined : g.url} target="_blank" rel="noreferrer" aria-label={g.caption ? `Open photo: ${g.caption}` : "Open photo"}>
              <Img src={g.url} className="aspect-[4/3] w-full object-cover" />
            </a>
            {g.caption && <p className="px-3 py-2 text-sm">{g.caption}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Tile({ s, href, className, children }: { s: PortalServiceView; href: (id: string) => string; className: string; children: ReactNode }) {
  return s.availableNow ? (
    <Link href={href(s.id)} className={cn(className, "active:scale-[0.98]")}>
      {children}
    </Link>
  ) : (
    <div className={cn(className, "opacity-60")} aria-disabled="true">
      {children}
    </div>
  );
}
