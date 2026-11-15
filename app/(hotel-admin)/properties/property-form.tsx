"use client";

import { useActionState } from "react";
import { LocationFields } from "@/components/location-fields";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form";
import type { ActionState } from "@/lib/actions";

type Values = Record<string, string | null | undefined>;

interface Props {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  initial?: Values;
  submitLabel: string;
  readOnly?: boolean;
}

export function PropertyForm({ action, initial = {}, submitLabel, readOnly }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const v: Values = state.values ?? initial;
  const e = state.fieldErrors ?? {};
  return (
    <Card>
      <form action={formAction} className="space-y-5" noValidate>
        {state.message && <Alert tone={state.ok ? "success" : "danger"}>{state.message}</Alert>}
        <fieldset disabled={readOnly || pending} className="space-y-5">
          <Field label="Property name" name="name" error={e.name}>
            <Input name="name" required defaultValue={v.name ?? ""} invalid={!!e.name} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Address line 1" name="addressLine1" error={e.addressLine1}>
              <Input name="addressLine1" autoComplete="address-line1" defaultValue={v.addressLine1 ?? ""} />
            </Field>
            <Field label="Address line 2" name="addressLine2" error={e.addressLine2}>
              <Input name="addressLine2" autoComplete="address-line2" defaultValue={v.addressLine2 ?? ""} />
            </Field>
            <Field label="City" name="city" error={e.city}>
              <Input name="city" defaultValue={v.city ?? ""} />
            </Field>
            <Field label="State / region" name="state" error={e.state}>
              <Input name="state" defaultValue={v.state ?? ""} />
            </Field>
            <Field label="Postal code" name="postalCode" error={e.postalCode}>
              <Input name="postalCode" defaultValue={v.postalCode ?? ""} />
            </Field>
            <Field label="Status" name="status" error={e.status}>
              <Select name="status" defaultValue={v.status ?? "active"}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </Select>
            </Field>
          </div>
          <LocationFields values={v} errors={e} />
        </fieldset>
        {!readOnly && (
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : submitLabel}
          </Button>
        )}
      </form>
    </Card>
  );
}
