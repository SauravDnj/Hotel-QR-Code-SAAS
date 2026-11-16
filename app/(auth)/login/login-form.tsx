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
      {state.values?.mfa ? (
        <Field label="Authenticator code" name="otp" hint="6 digits from your authenticator app.">
          <Input name="otp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required autoFocus />
        </Field>
      ) : (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">I use an authenticator app</summary>
          <div className="mt-2">
            <Field label="Authenticator code" name="otp">
              <Input name="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={7} />
            </Field>
          </div>
        </details>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
