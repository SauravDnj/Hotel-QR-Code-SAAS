"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { loginAction } from "../actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(loginAction, {});
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.message && <Alert tone="danger">{state.message}</Alert>}
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Email" name="email">
        <Input name="email" type="email" autoComplete="email" required defaultValue={state.values?.email} />
      </Field>
      <Field label="Password" name="password">
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
