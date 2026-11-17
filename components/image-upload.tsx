"use client";

import { ImagePlus, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import type { ActionState } from "@/lib/actions";
import { cn } from "@/lib/utils";

const MAX_BYTES = 1_400_000;

/**
 * Shrinks a photo in the browser (so phones' 5–10 MB camera pictures upload fast on hotel
 * Wi-Fi), then sends it to a server action as `file`. The server re-checks type and size.
 */
async function resize(file: File, maxSide: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  let scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  for (let attempt = 0; attempt < 4; attempt++) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const quality = attempt === 0 ? 0.85 : 0.72;
    const blob =
      (await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", quality))) ??
      (await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality)));
    // Old Safari ignores webp and returns PNG: re-encode as JPEG.
    const out =
      blob && blob.type === "image/png" ? await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality)) : blob;
    if (out && out.size <= MAX_BYTES) return out;
    scale *= 0.75;
  }
  throw new Error("This photo is too large. Try a smaller one.");
}

export function ImageUpload({
  action,
  label,
  maxSide = 1600,
  multiple = false,
  className,
  disabled,
}: {
  action: (fd: FormData) => Promise<ActionState>;
  label: string;
  maxSide?: number;
  multiple?: boolean;
  className?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>({});
  const [progress, setProgress] = useState("");

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    start(async () => {
      let last: ActionState = {};
      for (const [i, file] of files.entries()) {
        if (files.length > 1) setProgress(`${i + 1} of ${files.length}`);
        try {
          const blob = await resize(file, maxSide);
          const fd = new FormData();
          fd.set("file", blob, blob.type === "image/webp" ? "photo.webp" : "photo.jpg");
          last = await action(fd);
          if (!last.ok) break;
        } catch (err) {
          last = { ok: false, message: err instanceof Error ? err.message : "Could not read this photo." };
          break;
        }
      }
      setProgress("");
      setState(last);
      router.refresh();
    });
  }

  return (
    <div className={className}>
      <label
        htmlFor={id}
        className={cn(
          "inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-ui border border-dashed border-border bg-surface px-3 text-sm font-medium hover:bg-surface-muted",
          (pending || disabled) && "pointer-events-none opacity-60",
        )}
      >
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ImagePlus className="size-4" aria-hidden />}
        {pending ? `Uploading${progress ? ` ${progress}` : ""}…` : label}
      </label>
      <input
        id={id}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        multiple={multiple}
        className="sr-only"
        onChange={onChange}
        disabled={pending || disabled}
      />
      {state.message && (
        <p role={state.ok ? "status" : "alert"} className={cn("mt-1 text-xs", state.ok ? "text-success" : "text-danger")}>
          {state.message}
        </p>
      )}
    </div>
  );
}

/** Small button that runs a no-input server action (remove a photo, etc.). */
export function PhotoButton({
  action,
  children,
  label,
  danger,
}: {
  action: () => Promise<ActionState>;
  children: React.ReactNode;
  label: string;
  danger?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={pending}
      onClick={() =>
        start(async () => {
          await action();
          router.refresh();
        })
      }
      className={cn(
        "inline-flex min-h-8 items-center gap-1 rounded-ui border border-border bg-surface px-2 text-xs hover:bg-surface-muted disabled:opacity-50",
        danger && "text-danger",
      )}
    >
      {children}
    </button>
  );
}
