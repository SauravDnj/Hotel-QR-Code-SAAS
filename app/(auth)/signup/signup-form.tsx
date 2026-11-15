"use client";

import { useActionState } from "react";
import { LocationFields } from "@/components/location-fields";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { signupAction } from "../actions";

export function SignupForm() {
  const [state, action, pending] = useActionState(signupAction, {});
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.message && <Alert tone="danger">{state.message}</Alert>}
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold">Your account</legend>
        <Field label="Your name" name="ownerName" error={e.ownerName}>
          <Input name="ownerName" autoComplete="name" required defaultValue={v.ownerName} invalid={!!e.ownerName} />
        </Field>
        <Field label="Work email" name="email" error={e.email}>
          <Input name="email" type="email" autoComplete="email" required defaultValue={v.email} invalid={!!e.email} />
        </Field>
        <Field label="Password" name="password" error={e.password} hint="At least 10 characters">
          <Input name="password" type="password" autoComplete="new-password" required invalid={!!e.password} />
        </Field>
      </fieldset>
      <fieldset className="space-y-4 border-t border-border pt-4">
        <legend className="pt-4 text-sm font-semibold">Your hotel</legend>
        <Field label="Hotel display name" name="hotelName" error={e.hotelName}>
          <Input name="hotelName" required defaultValue={v.hotelName} invalid={!!e.hotelName} />
        </Field>
        <Field label="Legal / business name" name="legalName" error={e.legalName}>
          <Input name="legalName" required defaultValue={v.legalName} invalid={!!e.legalName} />
        </Field>
        <LocationFields values={v} errors={e} />
      </fieldset>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Creating your hotel…" : "Create hotel account"}
      </Button>
    </form>
  );
}
