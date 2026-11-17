"use client";

import Link from "next/link";
import { useActionState } from "react";
import { CopyButton } from "@/components/copy-button";
import { LocationFields } from "@/components/location-fields";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form";
import { createHotelAction, type CreateHotelState } from "../../actions";

export function CreateHotelForm({ plans }: { plans: { id: string; name: string; isDefault: boolean }[] }) {
  const [state, action, pending] = useActionState<CreateHotelState, FormData>(createHotelAction, {});
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};

  if (state.ok && state.link) {
    return (
      <div className="space-y-4">
        <Alert tone="success">
          <p>{state.message}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="max-w-full truncate rounded bg-surface-muted px-2 py-1 text-xs text-foreground" title="Owner set-password link">
              {state.link}
            </code>
            <CopyButton value={state.link} label="Copy owner link" />
          </div>
          <p className="mt-2 text-xs">
            Link expired? Create a new one from the hotel page (Staff → Reset password).
          </p>
        </Alert>
        <div className="flex gap-3">
          <Link href={`/platform/tenants/${state.tenantId}`} className="text-sm text-primary underline underline-offset-4">
            Open the new hotel →
          </Link>
          <button type="button" onClick={() => window.location.reload()} className="text-sm text-primary underline underline-offset-4">
            Add another hotel
          </button>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4" noValidate aria-label="Add hotel">
      {state.message && !state.ok && <Alert tone="danger">{state.message}</Alert>}
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold">Hotel</legend>
        <Field label="Hotel display name" name="hotelName" error={e.hotelName}>
          <Input name="hotelName" required defaultValue={v.hotelName} invalid={!!e.hotelName} />
        </Field>
        <Field label="Legal / business name" name="legalName" error={e.legalName}>
          <Input name="legalName" required defaultValue={v.legalName} invalid={!!e.legalName} />
        </Field>
        <LocationFields values={v} errors={e} />
        <Field label="Plan" name="planId" error={e.planId} hint="Starts as a free trial on this plan">
          <Select name="planId" defaultValue={v.planId ?? plans.find((p) => p.isDefault)?.id ?? ""}>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.isDefault ? " (default)" : ""}
              </option>
            ))}
          </Select>
        </Field>
      </fieldset>
      <fieldset className="space-y-4 border-t border-border pt-4">
        <legend className="pt-4 text-sm font-semibold">Hotel owner (admin login)</legend>
        <Field label="Owner name" name="ownerName" error={e.ownerName}>
          <Input name="ownerName" required defaultValue={v.ownerName} invalid={!!e.ownerName} />
        </Field>
        <Field label="Owner email" name="email" error={e.email} hint="They get a one-time link to choose their own password">
          <Input name="email" type="email" required defaultValue={v.email} invalid={!!e.email} />
        </Field>
      </fieldset>
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create hotel"}
      </Button>
    </form>
  );
}
