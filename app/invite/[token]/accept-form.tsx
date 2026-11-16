"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import type { ActionState } from "@/lib/actions";

export function AcceptForm({
  action,
  accountExists,
  defaultName,
}: {
  action: (p: ActionState, fd: FormData) => Promise<ActionState>;
  accountExists: boolean;
  defaultName: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const e = state.fieldErrors ?? {};
  return (
    <form action={formAction} className="mt-5 space-y-4" aria-label="Accept invitation">
      {state.message && !state.ok && <Alert tone="danger">{state.message}</Alert>}
      {!accountExists && (
        <Field label="Your name" name="name" error={e.name}>
          <Input name="name" required defaultValue={state.values?.name ?? defaultName} autoComplete="name" />
        </Field>
      )}
      <Field
        label={accountExists ? "Your existing password" : "Choose a password"}
        name="password"
        error={e.password}
        hint={accountExists ? "You already have an account; sign in to join this hotel too." : "At least 10 characters."}
      >
        <Input name="password" type="password" required autoComplete={accountExists ? "current-password" : "new-password"} />
      </Field>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Joining…" : "Join the team"}
      </Button>
    </form>
  );
}
