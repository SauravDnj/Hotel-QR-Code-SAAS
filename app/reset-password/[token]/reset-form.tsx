"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import type { ActionState } from "@/lib/actions";

export function ResetForm({ action }: { action: (p: ActionState, fd: FormData) => Promise<ActionState> }) {
  const [state, formAction, pending] = useActionState(action, {});
  const e = state.fieldErrors ?? {};
  return (
    <form action={formAction} className="mt-4 space-y-4" aria-label="New password">
      {state.message && !state.ok && <Alert tone="danger">{Object.values(e).flat()[0] ?? state.message}</Alert>}
      <Field label="New password" name="password" hint="At least 10 characters.">
        <Input name="password" type="password" autoComplete="new-password" required minLength={10} />
      </Field>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Saving…" : "Save new password"}
      </Button>
    </form>
  );
}
