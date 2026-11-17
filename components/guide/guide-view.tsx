"use client";

import {
  AlertTriangle,
  Bell,
  BookOpen,
  Building2,
  CalendarDays,
  ChartColumn,
  CreditCard,
  DoorOpen,
  HelpCircle,
  Image as ImageIcon,
  Inbox,
  KeyRound,
  Lightbulb,
  ListChecks,
  Lock,
  Palette,
  PlayCircle,
  Plus,
  Printer,
  QrCode,
  Receipt,
  RefreshCw,
  Rocket,
  Search,
  Settings,
  Shield,
  Smartphone,
  Sparkles,
  User,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { Guide, GuideBlock, GuideMedia, GuideSection } from "@/modules/help/content";

const ICONS: Record<string, LucideIcon> = {
  rocket: Rocket,
  "list-checks": ListChecks,
  building: Building2,
  qr: QrCode,
  bell: Bell,
  palette: Palette,
  users: Users,
  calendar: CalendarDays,
  key: KeyRound,
  receipt: Receipt,
  inbox: Inbox,
  sparkles: Sparkles,
  refresh: RefreshCw,
  phone: Smartphone,
  chart: ChartColumn,
  card: CreditCard,
  settings: Settings,
  user: User,
  help: HelpCircle,
  shield: Shield,
  lock: Lock,
  plus: Plus,
  door: DoorOpen,
};

function Icon({ name, className }: { name: string; className?: string }) {
  const C = ICONS[name] ?? BookOpen;
  return <C className={className} aria-hidden />;
}

/** Renders **bold** spans; everything else is plain text (no HTML is ever interpreted). */
function Rich({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <strong key={i} className="font-semibold text-foreground">
            {p}
          </strong>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

/** Lower-case, punctuation-free text so "wifi" finds "Wi-Fi" and "checkout" finds "check-out". */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/\*\*/g, "")
    .replace(/[-‐–—'’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function blockText(b: GuideBlock): string {
  switch (b.kind) {
    case "p":
    case "tip":
    case "warn":
      return b.text;
    case "steps":
    case "list":
      return b.items.join(" ");
    case "table":
      return [...b.head, ...b.rows.flat()].join(" ");
    case "links":
      return b.items.map((l) => l.label).join(" ");
    case "media":
      return b.items.map((m) => m.caption).join(" ");
  }
}

/* eslint-disable @next/next/no-img-element -- static guide captures, already sized and compressed */
function MediaItem({ item }: { item: GuideMedia }) {
  const frame = item.phone
    ? "mx-auto w-full max-w-[240px] overflow-hidden rounded-[1.75rem] border-[6px] border-foreground/80 bg-background shadow-lg"
    : "overflow-hidden rounded-ui border border-border bg-surface-muted shadow-sm";
  return (
    <figure className={cn("space-y-2", item.phone ? "w-[240px] max-w-full" : "w-full")}>
      {item.type === "video" ? (
        <div className={frame}>
          {/* Screen recordings have no sound; captions say what happens. */}
          <video src={item.src} controls preload="metadata" playsInline muted className="block w-full" aria-label={item.caption} />
        </div>
      ) : (
        <a href={item.src} target="_blank" rel="noreferrer" className={cn(frame, "block transition-opacity hover:opacity-90")} title="Open full size">
          <img src={item.src} alt={item.caption} loading="lazy" decoding="async" className="block w-full" />
        </a>
      )}
      <figcaption className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {item.type === "video" ? <PlayCircle className="size-3.5 shrink-0" aria-hidden /> : <ImageIcon className="size-3.5 shrink-0" aria-hidden />}
        {item.caption}
      </figcaption>
    </figure>
  );
}

function MediaBlock({ items }: { items: GuideMedia[] }) {
  const phones = items.filter((i) => i.phone);
  const wide = items.filter((i) => !i.phone);
  return (
    <div className="space-y-4 print:hidden">
      {phones.length > 0 && (
        <div className="flex flex-wrap justify-center gap-6 rounded-ui bg-surface-muted p-4 sm:justify-start">
          {phones.map((m) => (
            <MediaItem key={m.src} item={m} />
          ))}
        </div>
      )}
      {wide.length > 0 && (
        <div className={cn("grid gap-4", wide.length > 1 && "xl:grid-cols-2")}>
          {wide.map((m) => (
            <MediaItem key={m.src} item={m} />
          ))}
        </div>
      )}
    </div>
  );
}

function Block({ block, showLinks }: { block: GuideBlock; showLinks: boolean }) {
  switch (block.kind) {
    case "p":
      return (
        <p className="text-sm leading-relaxed text-muted-foreground">
          <Rich text={block.text} />
        </p>
      );
    case "steps":
      return (
        <ol className="space-y-3">
          {block.items.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                {i + 1}
              </span>
              <span className="pt-1 text-sm leading-relaxed text-muted-foreground">
                <Rich text={s} />
              </span>
            </li>
          ))}
        </ol>
      );
    case "list":
      return (
        <ul className="space-y-2">
          {block.items.map((s, i) => (
            <li key={i} className="flex gap-2 text-sm leading-relaxed text-muted-foreground">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
              <span>
                <Rich text={s} />
              </span>
            </li>
          ))}
        </ul>
      );
    case "table":
      return (
        <div className="overflow-x-auto rounded-ui border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-muted">
              <tr>
                {block.head.map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {block.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} className={cn("px-3 py-2 align-top", j === 0 ? "font-medium" : "text-muted-foreground")}>
                      <Rich text={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "tip":
      return (
        <div className="flex gap-3 rounded-ui border border-success/30 bg-success-surface px-4 py-3 text-sm">
          <Lightbulb className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
          <p>
            <span className="font-semibold text-success">Tip: </span>
            <Rich text={block.text} />
          </p>
        </div>
      );
    case "warn":
      return (
        <div className="flex gap-3 rounded-ui border border-warning/30 bg-warning-surface px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <p>
            <span className="font-semibold text-warning">Important: </span>
            <Rich text={block.text} />
          </p>
        </div>
      );
    case "media":
      return <MediaBlock items={block.items} />;
    case "links":
      if (!showLinks) return null;
      return (
        <div className="flex flex-wrap gap-2 print:hidden">
          {block.items.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="inline-flex min-h-9 items-center rounded-ui border border-primary/40 px-3 text-sm font-medium text-primary hover:bg-surface-muted"
            >
              {l.label} →
            </Link>
          ))}
        </div>
      );
  }
}

function SectionCard({ section, index, showLinks }: { section: GuideSection; index: number; showLinks: boolean }) {
  return (
    <section id={section.id} aria-labelledby={`${section.id}-h`} className="scroll-mt-24 rounded-ui border border-border bg-surface p-5 shadow-sm sm:p-6 print:break-inside-avoid print:shadow-none">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-ui bg-primary/10 text-primary">
          <Icon name={section.icon} className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {section.group} · {index + 1}
          </p>
          <h2 id={`${section.id}-h`} className="text-lg font-semibold">
            {section.title}
          </h2>
          <p className="text-sm text-muted-foreground">{section.summary}</p>
        </div>
      </div>
      <div className="space-y-4">
        {section.blocks.map((b, i) => (
          <Block key={i} block={b} showLinks={showLinks} />
        ))}
      </div>
    </section>
  );
}

export interface GuideTab {
  href: string;
  label: string;
  active: boolean;
}

/**
 * The in-app guide: numbered "where to start" cards, a grouped contents list (sticky on wide
 * screens), live search and print-to-PDF. `showLinks` hides "Open …" buttons where those pages
 * don't apply (a super admin reading the hotel guide has no hotel workspace).
 */
export function GuideView({ guide, tabs, showLinks = true }: { guide: Guide; tabs?: GuideTab[]; showLinks?: boolean }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string>(guide.sections[0]?.id ?? "");

  const q = normalize(query);
  const visible = useMemo(() => {
    if (!q) return guide.sections;
    const words = q.split(" ");
    return guide.sections.filter((s) => {
      const hay = normalize([s.title, s.summary, s.group, ...s.blocks.map(blockText)].join(" "));
      return words.every((w) => hay.includes(w));
    });
  }, [guide.sections, q]);

  const groups = useMemo(() => {
    const m = new Map<string, GuideSection[]>();
    for (const s of visible) m.set(s.group, [...(m.get(s.group) ?? []), s]);
    return [...m.entries()];
  }, [visible]);

  // Highlight the section being read: the last one whose top has scrolled past the reading line.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      let current = visible[0]?.id ?? "";
      for (const s of visible) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= 140) current = s.id;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [visible]);

  const contents = (
    <nav aria-label="Contents" className="space-y-4">
      {groups.map(([group, items]) => (
        <div key={group}>
          <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</p>
          <ul className="space-y-0.5">
            {items.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  aria-current={active === s.id ? "location" : undefined}
                  className={cn(
                    "flex items-center gap-2 rounded-ui px-2 py-1.5 text-sm hover:bg-surface-muted",
                    active === s.id && "bg-surface-muted font-medium text-primary",
                  )}
                >
                  <Icon name={s.icon} className="size-4 shrink-0" />
                  <span className="truncate">{s.title}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  const journeyIds = new Set(guide.sections.map((s) => s.id));
  const journey = guide.journey.filter((j) => journeyIds.has(j.section));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-primary">
            <BookOpen className="size-4" aria-hidden /> Help & guide
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">{guide.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{guide.intro}</p>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex min-h-10 items-center gap-2 rounded-ui border border-border bg-surface px-3 text-sm hover:bg-surface-muted print:hidden"
        >
          <Printer className="size-4" aria-hidden /> Print / save as PDF
        </button>
      </div>

      {tabs && tabs.length > 1 && (
        <nav aria-label="Guides" className="flex gap-1 border-b border-border print:hidden">
          {tabs.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              aria-current={t.active ? "page" : undefined}
              className={cn(
                "-mb-px border-b-2 px-4 py-2 text-sm",
                t.active ? "border-primary font-semibold text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      )}

      {journey.length > 0 && !q && (
        <div className="print:hidden">
          <h2 className="mb-2 text-sm font-semibold">Where to start</h2>
          <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {journey.map((j, i) => (
              <li key={j.section}>
                <a
                  href={`#${j.section}`}
                  className="flex h-full gap-3 rounded-ui border border-border bg-surface p-3 shadow-sm transition-colors hover:border-primary/50 hover:bg-surface-muted"
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    {i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{j.title}</span>
                    <span className="block text-xs text-muted-foreground">{j.text}</span>
                  </span>
                </a>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[250px_1fr]">
        <aside className="print:hidden lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto">
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the guide…"
              aria-label="Search the guide"
              className="min-h-10 w-full rounded-ui border border-border bg-surface pl-9 pr-8 text-sm"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
                <X className="size-4" />
              </button>
            )}
          </div>
          <details className="rounded-ui border border-border bg-surface lg:hidden">
            <summary className="flex min-h-10 cursor-pointer items-center gap-2 px-3 text-sm font-medium">
              <ListChecks className="size-4" aria-hidden /> Contents ({visible.length} sections)
            </summary>
            <div className="border-t border-border p-2">{contents}</div>
          </details>
          <div className="hidden lg:block">{contents}</div>
        </aside>

        <div className="min-w-0 space-y-4">
          {q && (
            <p className="text-sm text-muted-foreground" role="status">
              {visible.length === 0 ? `Nothing matches "${query}".` : `${visible.length} section${visible.length === 1 ? "" : "s"} match "${query}".`}
            </p>
          )}
          {visible.map((s) => (
            <SectionCard key={s.id} section={s} index={guide.sections.indexOf(s)} showLinks={showLinks} />
          ))}
        </div>
      </div>
    </div>
  );
}
