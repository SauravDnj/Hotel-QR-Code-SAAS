"use client";

import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useActionState } from "react";
import { ImageUpload, PhotoButton } from "@/components/image-upload";
import { Card } from "@/components/ui/card";
import { ServiceIcon } from "@/components/service-icon";
import type { ActionState } from "@/lib/actions";

/* eslint-disable @next/next/no-img-element -- hotel photos served from /media (already resized) */

type Upload = (fd: FormData) => Promise<ActionState>;
type Run = () => Promise<ActionState>;

export interface PhotosProps {
  readOnly: boolean;
  maxGallery: number;
  logo: { url: string | null; upload: Upload; remove: Run };
  cover: { url: string | null; upload: Upload; remove: Run };
  gallery: {
    upload: Upload;
    items: { id: string; url: string; caption: string | null; update: (p: ActionState, fd: FormData) => Promise<ActionState>; remove: Run }[];
  };
  services: { id: string; name: string; icon: string; enabled: boolean; imageUrl: string | null; upload: Upload; remove: Run }[];
}

function CaptionForm({ caption, action, disabled }: { caption: string | null; action: (p: ActionState, fd: FormData) => Promise<ActionState>; disabled: boolean }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex gap-1" aria-label="Photo caption">
      <input
        name="caption"
        defaultValue={caption ?? ""}
        maxLength={120}
        placeholder="Caption (optional)"
        aria-label="Caption"
        disabled={disabled}
        className="min-h-8 min-w-0 flex-1 rounded-ui border border-border bg-surface px-2 text-xs"
      />
      {!disabled && (
        <button type="submit" disabled={pending} className="rounded-ui border border-border px-2 text-xs hover:bg-surface-muted">
          {state.ok ? "Saved" : "Save"}
        </button>
      )}
    </form>
  );
}

function MoveButton({ action, dir }: { action: (p: ActionState, fd: FormData) => Promise<ActionState>; dir: "up" | "down" }) {
  const [, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction}>
      <input type="hidden" name="move" value={dir} />
      <button
        type="submit"
        disabled={pending}
        aria-label={dir === "up" ? "Move earlier" : "Move later"}
        title={dir === "up" ? "Move earlier" : "Move later"}
        className="inline-flex min-h-8 items-center rounded-ui border border-border bg-surface px-2 hover:bg-surface-muted"
      >
        {dir === "up" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
      </button>
    </form>
  );
}

function BrandSlot({ title, hint, slot, maxSide, readOnly, wide }: { title: string; hint: string; slot: PhotosProps["logo"]; maxSide: number; readOnly: boolean; wide?: boolean }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{title}</p>
      <div className={wide ? "aspect-[16/7] max-h-48 w-full" : "flex h-24 w-40 items-center justify-center"}>
        {slot.url ? (
          <img src={slot.url} alt={title} className={wide ? "size-full rounded-ui object-cover" : "max-h-24 max-w-40 rounded-ui object-contain"} />
        ) : (
          <div className="flex size-full items-center justify-center rounded-ui border border-dashed border-border text-xs text-muted-foreground">No photo yet</div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
      {!readOnly && (
        <div className="flex flex-wrap items-start gap-2">
          <ImageUpload action={slot.upload} label={slot.url ? "Replace" : "Upload"} maxSide={maxSide} />
          {slot.url && (
            <PhotoButton action={slot.remove} label={`Remove ${title.toLowerCase()}`} danger>
              <Trash2 className="size-3" aria-hidden /> Remove
            </PhotoButton>
          )}
        </div>
      )}
    </div>
  );
}

export function Photos({ readOnly, maxGallery, logo, cover, gallery, services }: PhotosProps) {
  return (
    <div className="space-y-6">
      <Card>
        <h3 className="mb-3 text-sm font-semibold">Logo and cover photo</h3>
        <div className="grid gap-6 sm:grid-cols-[200px_1fr]">
          <BrandSlot title="Logo" hint="Square or wide PNG/JPG. Transparent background works best." slot={logo} maxSide={600} readOnly={readOnly} />
          <BrandSlot title="Cover photo" hint="A wide photo of your hotel, lobby or view." slot={cover} maxSide={1800} readOnly={readOnly} wide />
        </div>
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Photo gallery</h3>
            <p className="text-xs text-muted-foreground">
              Rooms, restaurant, pool, spa… Guests swipe through these. {gallery.items.length}/{maxGallery} photos.
            </p>
          </div>
          {!readOnly && gallery.items.length < maxGallery && <ImageUpload action={gallery.upload} label="Add photos" multiple />}
        </div>
        {gallery.items.length === 0 ? (
          <p className="rounded-ui border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No photos yet. Add a few to make the guest page shine.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Gallery photos">
            {gallery.items.map((g, i) => (
              <li key={g.id} className="space-y-2 rounded-ui border border-border p-2">
                <img src={g.url} alt={g.caption ?? `Photo ${i + 1}`} className="aspect-[4/3] w-full rounded object-cover" />
                <CaptionForm caption={g.caption} action={g.update} disabled={readOnly} />
                {!readOnly && (
                  <div className="flex items-center gap-1">
                    {i > 0 && <MoveButton action={g.update} dir="up" />}
                    {i < gallery.items.length - 1 && <MoveButton action={g.update} dir="down" />}
                    <span className="flex-1" />
                    <PhotoButton action={g.remove} label={`Delete photo ${i + 1}`} danger>
                      <Trash2 className="size-3" aria-hidden /> Delete
                    </PhotoButton>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h3 className="text-sm font-semibold">Service photos</h3>
        <p className="mb-3 text-xs text-muted-foreground">Optional picture for each service tile (e.g. a dish for In-room dining). The Photo template shows them largest.</p>
        <ul className="divide-y divide-border" aria-label="Service photos">
          {services.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 py-2">
              {s.imageUrl ? (
                <img src={s.imageUrl} alt="" className="size-14 rounded object-cover" />
              ) : (
                <span className="flex size-14 items-center justify-center rounded bg-surface-muted text-muted-foreground">
                  <ServiceIcon name={s.icon} className="size-6" />
                </span>
              )}
              <span className="min-w-0 flex-1 text-sm">
                {s.name}
                {!s.enabled && <span className="block text-xs text-muted-foreground">Hidden from guests</span>}
              </span>
              {!readOnly && (
                <div className="flex items-start gap-2">
                  <ImageUpload action={s.upload} label={s.imageUrl ? "Replace" : "Add photo"} maxSide={1000} />
                  {s.imageUrl && (
                    <PhotoButton action={s.remove} label={`Remove photo of ${s.name}`} danger>
                      <Trash2 className="size-3" aria-hidden />
                    </PhotoButton>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
