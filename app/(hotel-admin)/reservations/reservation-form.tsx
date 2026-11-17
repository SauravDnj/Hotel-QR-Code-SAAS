"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form";
import type { ActionState } from "@/lib/actions";

export interface ReservationFormDefaults {
  categoryId?: string;
  roomId?: string | null;
  guestName?: string;
  phone?: string | null;
  email?: string | null;
  arrivalDate?: string;
  departureDate?: string;
  adults?: number;
  source?: string;
  externalRef?: string | null;
  notes?: string | null;
}

const SOURCES: [string, string][] = [
  ["direct", "Direct / website"],
  ["phone", "Phone"],
  ["email", "Email"],
  ["walk_in", "Walk-in"],
  ["ota", "Online travel agency"],
];

/** Create or edit a booking. Rooms are filtered to the chosen type; the server re-checks everything. */
export function ReservationForm({
  action,
  categories,
  rooms,
  defaults,
  submitLabel,
  editing = false,
}: {
  action: (p: ActionState, fd: FormData) => Promise<ActionState>;
  categories: { id: string; name: string; capacity: number }[];
  rooms: { id: string; roomCode: string; categoryId: string }[];
  defaults: ReservationFormDefaults;
  submitLabel: string;
  editing?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const e = state.fieldErrors ?? {};
  const v = state.ok && !editing ? {} : (state.values ?? {});
  const [categoryId, setCategoryId] = useState(v.categoryId ?? defaults.categoryId ?? categories[0]?.id ?? "");
  const roomChoices = rooms.filter((r) => r.categoryId === categoryId);
  const val = (k: keyof ReservationFormDefaults) => v[k] ?? (defaults[k] == null ? "" : String(defaults[k]));
  // Remount fields after a successful create so the form clears.
  const key = state.ok && !editing ? state.message : "form";

  return (
    <form action={formAction} className="space-y-4" aria-label={submitLabel} noValidate key={key}>
      {state.message && <Alert tone={state.ok ? "success" : "danger"}>{state.message}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Room type" name="categoryId" error={e.categoryId}>
          <Select
            name="categoryId"
            required
            value={categoryId}
            onChange={(ev) => setCategoryId(ev.target.value)}
            invalid={!!e.categoryId}
          >
            {categories.length === 0 && <option value="">No room types yet</option>}
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} (up to {c.capacity})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Room (optional)" name="roomId" error={e.roomId} hint="Leave unassigned to choose at check-in.">
          <Select name="roomId" defaultValue={val("roomId")} invalid={!!e.roomId} key={categoryId}>
            <option value="">Assign at check-in</option>
            {roomChoices.map((r) => (
              <option key={r.id} value={r.id}>
                {r.roomCode}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Arrival" name="arrivalDate" error={e.arrivalDate}>
            <Input name="arrivalDate" type="date" required defaultValue={val("arrivalDate")} invalid={!!e.arrivalDate} />
          </Field>
          <Field label="Departure" name="departureDate" error={e.departureDate}>
            <Input name="departureDate" type="date" required defaultValue={val("departureDate")} invalid={!!e.departureDate} />
          </Field>
        </div>
        <Field label="Guests" name="adults" error={e.adults}>
          <Input name="adults" type="number" min={1} max={20} defaultValue={val("adults") || "1"} invalid={!!e.adults} />
        </Field>
        <Field label="Guest name" name="guestName" error={e.guestName}>
          <Input name="guestName" required maxLength={120} defaultValue={val("guestName")} invalid={!!e.guestName} autoComplete="off" />
        </Field>
        <Field label="Phone (optional)" name="phone" error={e.phone}>
          <Input name="phone" type="tel" defaultValue={val("phone")} invalid={!!e.phone} autoComplete="off" />
        </Field>
        <Field label="Email (optional)" name="email" error={e.email}>
          <Input name="email" type="email" defaultValue={val("email")} invalid={!!e.email} autoComplete="off" />
        </Field>
        {!editing && (
          <>
            <Field label="Booked via" name="source" error={e.source}>
              <Select name="source" defaultValue={val("source") || "direct"}>
                {SOURCES.map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="External reference (optional)" name="externalRef" error={e.externalRef} hint="e.g. the OTA booking number">
              <Input name="externalRef" maxLength={80} defaultValue={val("externalRef")} autoComplete="off" />
            </Field>
          </>
        )}
        <Field label="Notes (staff only)" name="notes" error={e.notes}>
          <Input name="notes" maxLength={500} defaultValue={val("notes")} />
        </Field>
      </div>
      <Button type="submit" disabled={pending || categories.length === 0}>
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
