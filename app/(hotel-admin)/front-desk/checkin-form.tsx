"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form";
import type { ActionState } from "@/lib/actions";

export function CheckInForm({
  action,
  rooms,
  defaultDate,
  defaultTime,
}: {
  action: (p: ActionState, fd: FormData) => Promise<ActionState>;
  rooms: { id: string; roomCode: string; floorName: string }[];
  defaultDate: string;
  defaultTime: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const e = state.fieldErrors ?? {};
  const v = state.ok ? {} : (state.values ?? {});
  return (
    <form action={formAction} className="space-y-4" aria-label="Check in" noValidate>
      {state.message && <Alert tone={state.ok ? "success" : "danger"}>{state.message}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Room" name="roomId" error={e.roomId}>
          <Select name="roomId" required defaultValue={v.roomId ?? ""} invalid={!!e.roomId}>
            <option value="" disabled>
              {rooms.length ? "Choose a ready room…" : "No room is ready"}
            </option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.roomCode} · {r.floorName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Guest name" name="guestName" error={e.guestName}>
          <Input name="guestName" required maxLength={120} defaultValue={v.guestName ?? ""} invalid={!!e.guestName} autoComplete="off" />
        </Field>
        <Field label="Phone (optional)" name="phone" error={e.phone}>
          <Input name="phone" type="tel" defaultValue={v.phone ?? ""} invalid={!!e.phone} autoComplete="off" />
        </Field>
        <Field label="Email (optional)" name="email" error={e.email}>
          <Input name="email" type="email" defaultValue={v.email ?? ""} invalid={!!e.email} autoComplete="off" />
        </Field>
        <Field label="Guests" name="adults" error={e.adults}>
          <Input name="adults" type="number" min={1} max={20} defaultValue={v.adults ?? "1"} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Checkout date" name="checkoutDate" error={e.checkoutDate}>
            <Input name="checkoutDate" type="date" required defaultValue={v.checkoutDate ?? defaultDate} invalid={!!e.checkoutDate} />
          </Field>
          <Field label="Time" name="checkoutTime" error={e.checkoutTime}>
            <Input name="checkoutTime" type="time" defaultValue={v.checkoutTime ?? defaultTime} />
          </Field>
        </div>
        <Field label="Notes (staff only)" name="notes" error={e.notes}>
          <Input name="notes" maxLength={500} defaultValue={v.notes ?? ""} />
        </Field>
      </div>
      <Button type="submit" disabled={pending || rooms.length === 0}>
        {pending ? "Checking in…" : "Check in"}
      </Button>
    </form>
  );
}
