"use client";

import { Check } from "lucide-react";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import type { ActionState } from "@/lib/actions";
import { cn } from "@/lib/utils";
import type { GuestPortal } from "@/modules/guest-portal/public";
import { PortalView, type PortalServiceView } from "@/app/r/portal-view";

type Theme = GuestPortal["theme"];

const TEMPLATES: { key: Theme; name: string; text: string }[] = [
  { key: "classic", name: "Classic", text: "Coloured header, two-column service tiles." },
  { key: "photo", name: "Photo", text: "Big cover photo and picture tiles. Best with photos." },
  { key: "elegant", name: "Elegant", text: "Luxury look: serif type, centred, list of services." },
  { key: "minimal", name: "Minimal", text: "Compact and quick: small icon grid." },
];

export const PALETTES: { name: string; accent: string; background: string }[] = [
  { name: "Navy & sand", accent: "#1e3a5f", background: "#f5f1ea" },
  { name: "Emerald", accent: "#0f766e", background: "#effcf8" },
  { name: "Royal maroon", accent: "#7f1d1d", background: "#fdf6f0" },
  { name: "Ocean", accent: "#0369a1", background: "#eff8ff" },
  { name: "Sunset", accent: "#c2410c", background: "#fff7ed" },
  { name: "Night & gold", accent: "#b08d57", background: "#14181f" },
  { name: "Lavender", accent: "#6d28d9", background: "#f6f3ff" },
  { name: "Forest", accent: "#166534", background: "#f5fbe9" },
  { name: "Plain white", accent: "#1f2a44", background: "" },
];

interface Values {
  theme: Theme;
  accentColor: string;
  backgroundColor: string;
  fontStyle: "sans" | "serif";
  showGallery: boolean;
}

function ColorField({ name, label, value, onChange, allowEmpty }: { name: string; label: string; value: string; onChange: (v: string) => void; allowEmpty?: boolean }) {
  const valid = /^#[0-9a-f]{6}$/i.test(value);
  return (
    <div className="space-y-1">
      <label htmlFor={name} className="block text-sm font-medium">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={valid ? value : "#ffffff"}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-12 cursor-pointer rounded-ui border border-border bg-surface p-1"
        />
        <input
          id={name}
          name={name}
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
          placeholder={allowEmpty ? "Default" : "#1E3A5F"}
          maxLength={7}
          className="min-h-10 w-28 rounded-ui border border-border bg-surface px-2 font-mono text-sm uppercase"
        />
        {allowEmpty && value && (
          <button type="button" onClick={() => onChange("")} className="text-xs text-primary underline underline-offset-4">
            Use default
          </button>
        )}
      </div>
    </div>
  );
}

export function DesignForm({
  action,
  initial,
  portal,
  services,
  readOnly,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  initial: Values;
  portal: GuestPortal;
  services: PortalServiceView[];
  readOnly: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [v, setV] = useState<Values>(initial);
  const set = <K extends keyof Values>(k: K, value: Values[K]) => setV((cur) => ({ ...cur, [k]: value }));
  const valid = (c: string) => /^#[0-9a-f]{6}$/i.test(c);

  const preview: GuestPortal = {
    ...portal,
    theme: v.theme,
    accentColor: valid(v.accentColor) ? v.accentColor.toLowerCase() : null,
    backgroundColor: valid(v.backgroundColor) ? v.backgroundColor.toLowerCase() : null,
    fontStyle: v.fontStyle,
    gallery: v.showGallery ? portal.gallery : [],
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <form action={formAction} className="space-y-6" aria-label="Guest page design">
        {state.message && <Alert tone={state.ok ? "success" : "danger"}>{state.message}</Alert>}
        <fieldset disabled={readOnly || pending} className="space-y-6">
          <Card className="space-y-3">
            <h3 className="text-sm font-semibold">1. Choose a template</h3>
            <input type="hidden" name="theme" value={v.theme} />
            <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Template">
              {TEMPLATES.map((t) => {
                const active = v.theme === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => set("theme", t.key)}
                    className={cn(
                      "relative rounded-ui border p-3 text-left text-sm transition-colors",
                      active ? "border-primary ring-2 ring-primary/30" : "border-border hover:bg-surface-muted",
                    )}
                  >
                    <TemplateThumb theme={t.key} accent={valid(v.accentColor) ? v.accentColor : "#1f2a44"} />
                    <span className="mt-2 block font-medium">{t.name}</span>
                    <span className="block text-xs text-muted-foreground">{t.text}</span>
                    {active && <Check className="absolute right-2 top-2 size-4 text-primary" aria-hidden />}
                  </button>
                );
              })}
            </div>
          </Card>

          <Card className="space-y-4">
            <h3 className="text-sm font-semibold">2. Pick colours</h3>
            <div>
              <p className="mb-2 text-xs text-muted-foreground">Ready-made palettes (one click):</p>
              <div className="flex flex-wrap gap-2">
                {PALETTES.map((p) => {
                  const active = v.accentColor.toLowerCase() === p.accent && v.backgroundColor.toLowerCase() === p.background;
                  return (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => setV((cur) => ({ ...cur, accentColor: p.accent, backgroundColor: p.background }))}
                      aria-pressed={active}
                      className={cn(
                        "flex items-center gap-2 rounded-full border px-2 py-1 text-xs",
                        active ? "border-primary ring-2 ring-primary/30" : "border-border hover:bg-surface-muted",
                      )}
                    >
                      <span className="flex overflow-hidden rounded-full border border-border">
                        <span className="size-4" style={{ background: p.accent }} />
                        <span className="size-4" style={{ background: p.background || "#ffffff" }} />
                      </span>
                      {p.name}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex flex-wrap gap-6">
              <ColorField name="accentColor" label="Main colour (buttons, header)" value={v.accentColor} onChange={(c) => set("accentColor", c)} />
              <ColorField name="backgroundColor" label="Page background" value={v.backgroundColor} onChange={(c) => set("backgroundColor", c)} allowEmpty />
            </div>
            <p className="text-xs text-muted-foreground">Text colour is chosen automatically so it stays readable on your colours.</p>
          </Card>

          <Card className="space-y-3">
            <h3 className="text-sm font-semibold">3. Font and photos</h3>
            <div className="flex flex-wrap gap-3" role="radiogroup" aria-label="Font">
              {(["sans", "serif"] as const).map((f) => (
                <label
                  key={f}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center gap-2 rounded-ui border px-3 text-sm",
                    v.fontStyle === f ? "border-primary ring-2 ring-primary/30" : "border-border",
                  )}
                  style={f === "serif" ? { fontFamily: 'Georgia, "Times New Roman", serif' } : undefined}
                >
                  <input type="radio" name="fontStyle" value={f} checked={v.fontStyle === f} onChange={() => set("fontStyle", f)} />
                  {f === "sans" ? "Modern (sans-serif)" : "Classic (serif)"}
                </label>
              ))}
            </div>
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input type="checkbox" name="showGallery" checked={v.showGallery} onChange={(e) => set("showGallery", e.target.checked)} className="size-4" />
              Show the photo gallery to guests
            </label>
          </Card>

          {!readOnly && (
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save design"}
            </Button>
          )}
        </fieldset>
      </form>

      <div className="lg:sticky lg:top-4 lg:self-start">
        <p className="mb-2 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">Live preview</p>
        <div className="mx-auto w-full max-w-[380px] overflow-hidden rounded-[2rem] border-8 border-foreground/80 bg-background shadow-xl">
          <div className="h-[640px] overflow-y-auto" aria-label="Guest page preview" role="region">
            <div className="pointer-events-none flex min-h-full flex-col select-none" inert>
              <PortalView portal={preview} services={services} token={null} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TemplateThumb({ theme, accent }: { theme: Theme; accent: string }) {
  const bar = <span className="block h-1.5 rounded-full bg-border" />;
  return (
    <span className="block h-24 overflow-hidden rounded-md border border-border bg-surface-muted p-2" aria-hidden>
      {theme === "classic" && (
        <span className="flex h-full flex-col gap-1">
          <span className="block h-8 rounded" style={{ background: accent }} />
          <span className="grid flex-1 grid-cols-2 gap-1">
            <span className="rounded bg-surface" />
            <span className="rounded bg-surface" />
          </span>
        </span>
      )}
      {theme === "photo" && (
        <span className="flex h-full flex-col gap-1">
          <span className="block h-10 rounded bg-gradient-to-br from-slate-400 to-slate-700" />
          <span className="grid flex-1 grid-cols-2 gap-1">
            <span className="rounded bg-gradient-to-br from-amber-300 to-amber-600" />
            <span className="rounded bg-gradient-to-br from-sky-300 to-sky-600" />
          </span>
        </span>
      )}
      {theme === "elegant" && (
        <span className="flex h-full flex-col items-center gap-1 bg-surface p-1">
          <span className="mt-1 block h-2 w-16 rounded-full bg-border" />
          <span className="block h-px w-8" style={{ background: accent }} />
          <span className="mt-1 flex w-full flex-col gap-1">
            {bar}
            {bar}
            {bar}
          </span>
        </span>
      )}
      {theme === "minimal" && (
        <span className="flex h-full flex-col gap-1">
          <span className="flex h-6 items-center gap-1 rounded bg-surface px-1">
            <span className="size-4 rounded" style={{ background: accent }} />
            <span className="h-1.5 w-12 rounded-full bg-border" />
          </span>
          <span className="grid flex-1 grid-cols-3 gap-1">
            {Array.from({ length: 6 }, (_, i) => (
              <span key={i} className="rounded bg-surface" />
            ))}
          </span>
        </span>
      )}
    </span>
  );
}
