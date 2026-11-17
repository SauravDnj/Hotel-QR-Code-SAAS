"use client";

import { Star } from "lucide-react";
import { useActionState, useState } from "react";
import { readableOn } from "@/app/r/readable";
import type { RateState } from "./actions";

const LABELS = ["", "Poor", "Not great", "Okay", "Good", "Excellent"];

/** 1–5 stars + optional comment, shown on the guest's status page once a request is completed. */
export function RateForm({ action, accent, maxComment }: { action: (p: RateState, fd: FormData) => Promise<RateState>; accent: string; maxComment: number }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const shown = hover || rating;

  if (state.ok) {
    return (
      <p className="mt-5 rounded-xl bg-surface-muted p-4 text-center text-sm font-medium" role="status">
        {state.message}
      </p>
    );
  }

  return (
    <form action={formAction} className="mt-5 space-y-3 border-t border-border pt-4" aria-label="Rate this request">
      <h2 className="font-semibold">How did we do?</h2>
      <div className="flex items-center gap-1" role="radiogroup" aria-label="Rating" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="cursor-pointer p-1" onMouseEnter={() => setHover(n)}>
            <input type="radio" name="rating" value={n} className="sr-only" checked={rating === n} onChange={() => setRating(n)} aria-label={`${n} star${n > 1 ? "s" : ""}: ${LABELS[n]}`} />
            <Star className="size-9 transition-transform active:scale-90" style={{ color: accent, fill: n <= shown ? accent : "transparent" }} aria-hidden />
          </label>
        ))}
        <span className="ml-2 text-sm text-muted-foreground" aria-hidden>
          {LABELS[shown]}
        </span>
      </div>
      {rating > 0 && (
        <>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">Anything to add? (optional)</span>
            <textarea
              name="comment"
              rows={3}
              maxLength={maxComment}
              className="w-full rounded-xl border border-border bg-surface p-3 text-base"
              placeholder={rating <= 3 ? "What could we do better?" : "What did you like?"}
            />
          </label>
          <p className="text-xs text-muted-foreground">Please don&apos;t include personal or payment details.</p>
          <button
            type="submit"
            disabled={pending}
            className="min-h-12 w-full rounded-xl font-semibold disabled:opacity-60"
            style={{ background: accent, color: readableOn(accent) }}
          >
            {pending ? "Sending…" : "Send rating"}
          </button>
        </>
      )}
      {state.message && (
        <p className="text-sm text-danger" role="alert">
          {state.message}
        </p>
      )}
    </form>
  );
}
