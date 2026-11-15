"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form";
import type { ActionState } from "@/lib/actions";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;
type Option = { id: string; name: string };

interface RoomFormProps {
  action: Action;
  floors: Option[];
  categories: (Option & { capacity: number })[];
  initial?: Record<string, string | null | undefined>;
  submitLabel: string;
  readOnly?: boolean;
}

export function RoomForm({ action, floors, categories, initial = {}, submitLabel, readOnly }: RoomFormProps) {
  const [state, formAction, pending] = useActionState(action, {});
  const v = state.values ?? initial;
  const e = state.fieldErrors ?? {};
  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.message && <Alert tone={state.ok ? "success" : "danger"}>{state.message}</Alert>}
      <fieldset disabled={readOnly || pending} className="grid gap-4 sm:grid-cols-2">
        <Field label="Room number" name="roomCode" error={e.roomCode}>
          <Input name="roomCode" required defaultValue={v.roomCode ?? ""} invalid={!!e.roomCode} placeholder="e.g. 101" />
        </Field>
        <Field label="Guest capacity (optional)" name="capacity" error={e.capacity} hint="Leave empty to use the room type's capacity">
          <Input name="capacity" type="number" min={1} max={50} defaultValue={v.capacity ?? ""} invalid={!!e.capacity} />
        </Field>
        <Field label="Floor" name="floorId" error={e.floorId}>
          <Select name="floorId" required defaultValue={v.floorId ?? floors[0]?.id} invalid={!!e.floorId}>
            {floors.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Room type" name="categoryId" error={e.categoryId}>
          <Select name="categoryId" required defaultValue={v.categoryId ?? categories[0]?.id} invalid={!!e.categoryId}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} (up to {c.capacity})
              </option>
            ))}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Internal notes (optional)" name="notes" error={e.notes} hint="Visible to staff only, never to guests">
            <Input name="notes" defaultValue={v.notes ?? ""} />
          </Field>
        </div>
      </fieldset>
      {!readOnly && (
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      )}
    </form>
  );
}

export function BulkRoomForm({ action, floors, categories }: Omit<RoomFormProps, "submitLabel" | "initial" | "readOnly">) {
  const [state, formAction, pending] = useActionState(action, {});
  const v = state.ok ? {} : (state.values ?? {});
  const e = state.fieldErrors ?? {};
  return (
    <Card>
      <h3 className="text-sm font-semibold">Add a range of rooms</h3>
      <p className="mb-4 text-sm text-muted-foreground">
        For example floor 1 rooms 101–120. Up to 200 at a time; if any number already exists, nothing is created.
      </p>
      <form action={formAction} className="space-y-4" noValidate>
        {state.message && <Alert tone={state.ok ? "success" : "danger"}>{state.message}</Alert>}
        <fieldset disabled={pending} className="grid gap-4 sm:grid-cols-5">
          <Field label="Prefix" name="prefix" error={e.prefix} hint="Optional, e.g. A">
            <Input name="prefix" maxLength={8} defaultValue={v.prefix ?? ""} />
          </Field>
          <Field label="From" name="start" error={e.start}>
            <Input name="start" type="number" min={0} required defaultValue={v.start ?? ""} invalid={!!e.start} />
          </Field>
          <Field label="To" name="end" error={e.end}>
            <Input name="end" type="number" min={0} required defaultValue={v.end ?? ""} invalid={!!e.end} />
          </Field>
          <Field label="Floor" name="bulk-floor" error={e.floorId}>
            <Select name="floorId" id="bulk-floor" defaultValue={v.floorId ?? floors[0]?.id}>
              {floors.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Room type" name="bulk-category" error={e.categoryId}>
            <Select name="categoryId" id="bulk-category" defaultValue={v.categoryId ?? categories[0]?.id}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </fieldset>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create rooms"}
        </Button>
      </form>
    </Card>
  );
}
