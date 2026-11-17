"use client";

import { useActionState, useMemo, useState } from "react";
import type { GuestFormState } from "../../../actions";

interface MenuItem {
  id: string;
  section: string | null;
  name: string;
  description: string | null;
  priceMinor: number;
}

interface Props {
  action: (prev: GuestFormState, fd: FormData) => Promise<GuestFormState>;
  serviceId: string;
  idempotencyKey: string;
  menu: MenuItem[];
  currency: string;
  canChargeRoom: boolean;
  noteMode: "none" | "optional" | "required";
  accent: string;
  onAccent: string;
}

function money(minor: number, currency: string) {
  let digits = 2;
  try {
    digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, minimumFractionDigits: digits }).format(minor / 10 ** digits);
  } catch {
    return `${(minor / 10 ** digits).toFixed(digits)} ${currency}`;
  }
}

/** Menu cart for dining/laundry. Prices shown here are informational; the server reprices. */
export function OrderForm({ action, serviceId, idempotencyKey, menu, currency, canChargeRoom, noteMode, accent, onAccent }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const [qty, setQty] = useState<Record<string, number>>({});
  const [pay, setPay] = useState<"room" | "on_delivery">(canChargeRoom ? "room" : "on_delivery");
  const e = state.fieldErrors ?? {};
  const sections = useMemo(() => {
    const map = new Map<string, MenuItem[]>();
    for (const m of menu) map.set(m.section ?? "", [...(map.get(m.section ?? "") ?? []), m]);
    return [...map.entries()];
  }, [menu]);
  const total = menu.reduce((s, m) => s + (qty[m.id] ?? 0) * m.priceMinor, 0);
  const count = Object.values(qty).reduce((a, b) => a + b, 0);
  const change = (id: string, d: number) => setQty((q) => ({ ...q, [id]: Math.min(20, Math.max(0, (q[id] ?? 0) + d)) }));

  if (menu.length === 0) {
    return (
      <p className="mt-4 rounded-xl bg-surface-muted p-3 text-sm" role="status">
        The menu isn&apos;t available right now. Please call reception.
      </p>
    );
  }

  return (
    <form action={formAction} className="mt-5 space-y-5" aria-label="Order form">
      <input type="hidden" name="serviceId" value={serviceId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      {Object.entries(qty)
        .filter(([, n]) => n > 0)
        .map(([id, n]) => (
          <input key={id} type="hidden" name={`item:${id}`} value={n} />
        ))}

      {sections.map(([section, items]) => (
        <section key={section || "items"} aria-label={section || "Menu"}>
          {section && <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{section}</h2>}
          <ul className="divide-y divide-border rounded-xl border border-border">
            {items.map((m) => (
              <li key={m.id} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{m.name}</p>
                  {m.description && <p className="text-xs text-muted-foreground">{m.description}</p>}
                  <p className="text-sm">{money(m.priceMinor, currency)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => change(m.id, -1)}
                    disabled={!qty[m.id]}
                    className="size-10 rounded-full border border-border text-xl disabled:opacity-40"
                    aria-label={`Fewer ${m.name}`}
                  >
                    −
                  </button>
                  <output aria-live="polite" aria-label={`${m.name} quantity`} className="w-6 text-center font-semibold tabular-nums">
                    {qty[m.id] ?? 0}
                  </output>
                  <button
                    type="button"
                    onClick={() => change(m.id, 1)}
                    className="size-10 rounded-full border border-border text-xl"
                    aria-label={`More ${m.name}`}
                  >
                    +
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {e.items && <p className="text-sm text-danger">{e.items[0]}</p>}

      <fieldset>
        <legend className="mb-2 text-sm font-medium">How would you like to pay?</legend>
        <div className="grid gap-2">
          {canChargeRoom && (
            <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-border px-4">
              <input
                type="radio"
                name="paymentMethod"
                value="room"
                checked={pay === "room"}
                onChange={() => setPay("room")}
                className="size-5"
                style={{ accentColor: accent }}
              />
              <span>Add to my room bill</span>
            </label>
          )}
          <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-border px-4">
            <input
              type="radio"
              name="paymentMethod"
              value="on_delivery"
              checked={pay === "on_delivery"}
              onChange={() => setPay("on_delivery")}
              className="size-5"
              style={{ accentColor: accent }}
            />
            <span>Pay on delivery (cash, card or UPI)</span>
          </label>
        </div>
        {e.paymentMethod && <p className="mt-1 text-sm text-danger">{e.paymentMethod[0]}</p>}
      </fieldset>

      {noteMode !== "none" && (
        <div>
          <label htmlFor="note" className="mb-2 block text-sm font-medium">
            {noteMode === "required" ? "Instructions" : "Instructions (optional)"}
          </label>
          <textarea
            id="note"
            name="note"
            rows={2}
            maxLength={500}
            required={noteMode === "required"}
            className="block w-full rounded-xl border border-border bg-surface px-3 py-2 text-base"
          />
          {e.note && <p className="mt-1 text-sm text-danger">{e.note[0]}</p>}
          <p className="mt-1 text-xs text-muted-foreground">e.g. allergies or delivery time. No payment details.</p>
        </div>
      )}

      {state.message && (
        <p role="alert" className="rounded-xl bg-danger-surface p-3 text-sm text-danger">
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || state.unavailable || count === 0}
        className="flex min-h-14 w-full items-center justify-center rounded-2xl text-base font-semibold shadow-sm disabled:opacity-60"
        style={{ background: accent, color: onAccent }}
      >
        {pending ? "Sending…" : count === 0 ? "Choose items" : `Place order · ${money(total, currency)}`}
      </button>
    </form>
  );
}
