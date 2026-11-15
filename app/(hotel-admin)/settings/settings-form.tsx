"use client";

import { useActionState } from "react";
import { LocationFields } from "@/components/location-fields";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { updateTenantSettingsAction } from "./actions";

export function SettingsForm({ initial, readOnly }: { initial: Record<string, string>; readOnly?: boolean }) {
  const [state, action, pending] = useActionState(updateTenantSettingsAction, {});
  const v = state.values ?? initial;
  const e = state.fieldErrors ?? {};
  return (
    <Card>
      <form action={action} className="space-y-5" noValidate>
        {state.message && <Alert tone={state.ok ? "success" : "danger"}>{state.message}</Alert>}
        <fieldset disabled={readOnly || pending} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Hotel display name" name="name" error={e.name}>
              <Input name="name" required defaultValue={v.name} invalid={!!e.name} />
            </Field>
            <Field label="Legal / business name" name="legalName" error={e.legalName}>
              <Input name="legalName" required defaultValue={v.legalName} invalid={!!e.legalName} />
            </Field>
            <Field label="Contact email" name="contactEmail" error={e.contactEmail}>
              <Input name="contactEmail" type="email" required defaultValue={v.contactEmail} invalid={!!e.contactEmail} />
            </Field>
          </div>
          <LocationFields values={v} errors={e} />
        </fieldset>
        {!readOnly && (
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save settings"}
          </Button>
        )}
      </form>
    </Card>
  );
}
