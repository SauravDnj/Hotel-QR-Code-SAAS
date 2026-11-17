"use client";

import { useActionState, useState } from "react";
import type { GuestFormState } from "../../../actions";

interface Props {
  action: (prev: GuestFormState, fd: FormData) => Promise<GuestFormState>;
  serviceId: string;
  /** Fixed for this form render: a double tap or network retry re-sends the same key. */
  idempotencyKey: string;
  maxQuantity: number;
  options: string[];
  noteMode: "none" | "optional" | "required";
  accent: string;
  onAccent: string;
  /** Booking services (Phase 9): choose a local date and time. */
  booking?: { minDate: string; maxDate: string; from: string | null; to: string | null };
}

export function RequestForm({ action, serviceId, idempotencyKey, maxQuantity, options, noteMode, accent, onAccent, booking }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const [qty, setQty] = useState(1);
  const e = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="mt-5 space-y-5" aria-label="Request form">
      <input type="hidden" name="serviceId" value={serviceId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      {booking && (
        <fieldset>
          <legend className="mb-2 text-sm font-medium">When?</legend>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="scheduledDate" className="mb-1 block text-xs text-muted-foreground">
                Date
              </label>
              <input
                id="scheduledDate"
                name="scheduledDate"
                type="date"
                required
                min={booking.minDate}
                max={booking.maxDate}
                defaultValue={booking.minDate}
                className="block min-h-12 w-full rounded-xl border border-border bg-surface px-3 text-base"
              />
            </div>
            <div>
              <label htmlFor="scheduledTime" className="mb-1 block text-xs text-muted-foreground">
                Time
              </label>
              <input
                id="scheduledTime"
                name="scheduledTime"
                type="time"
                required
                className="block min-h-12 w-full rounded-xl border border-border bg-surface px-3 text-base"
                aria-invalid={e.scheduledTime ? true : undefined}
              />
            </div>
          </div>
          {booking.from && booking.to && (
            <p className="mt-1 text-xs text-muted-foreground">
              Available {booking.from}–{booking.to}
            </p>
          )}
          {(e.scheduledTime || e.scheduledDate) && (
            <p className="mt-1 text-sm text-danger">{(e.scheduledTime ?? e.scheduledDate)![0]}</p>
          )}
        </fieldset>
      )}

      {maxQuantity > 0 && (
        <fieldset>
          <legend className="mb-2 text-sm font-medium">How many?</legend>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              className="size-12 rounded-full border border-border text-2xl"
              aria-label="Fewer"
            >
              −
            </button>
            <output aria-live="polite" className="w-8 text-center text-2xl font-semibold tabular-nums">
              {qty}
            </output>
            <input type="hidden" name="quantity" value={qty} />
            <button
              type="button"
              onClick={() => setQty((q) => Math.min(maxQuantity, q + 1))}
              className="size-12 rounded-full border border-border text-2xl"
              aria-label="More"
            >
              +
            </button>
          </div>
          {e.quantity && <p className="mt-1 text-sm text-danger">{e.quantity[0]}</p>}
        </fieldset>
      )}

      {options.length > 0 && (
        <fieldset>
          <legend className="mb-2 text-sm font-medium">What do you need?</legend>
          <div className="grid gap-2">
            {options.map((o) => (
              <label
                key={o}
                className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-border px-4 has-[:checked]:border-2"
                style={{ borderColor: undefined }}
              >
                <input type="radio" name="option" value={o} required className="size-5" style={{ accentColor: accent }} />
                <span className="text-base">{o}</span>
              </label>
            ))}
          </div>
          {e.option && <p className="mt-1 text-sm text-danger">{e.option[0]}</p>}
        </fieldset>
      )}

      {noteMode !== "none" && (
        <div>
          <label htmlFor="note" className="mb-2 block text-sm font-medium">
            {noteMode === "required" ? "Tell us what you need" : "Anything else? (optional)"}
          </label>
          <textarea
            id="note"
            name="note"
            rows={3}
            maxLength={500}
            required={noteMode === "required"}
            className="block w-full rounded-xl border border-border bg-surface px-3 py-2 text-base"
            aria-invalid={e.note ? true : undefined}
          />
          {e.note && <p className="mt-1 text-sm text-danger">{e.note[0]}</p>}
          <p className="mt-1 text-xs text-muted-foreground">Please don&apos;t include personal or payment details.</p>
        </div>
      )}

      {state.message && (
        <p role="alert" className="rounded-xl bg-danger-surface p-3 text-sm text-danger">
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || state.unavailable}
        className="flex min-h-14 w-full items-center justify-center rounded-2xl text-base font-semibold shadow-sm disabled:opacity-60"
        style={{ background: accent, color: onAccent }}
      >
        {pending ? "Sending…" : booking ? "Request booking" : "Send request"}
      </button>
    </form>
  );
}
