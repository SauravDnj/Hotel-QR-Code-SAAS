"use client";

import { useActionState, type ReactNode } from "react";
import { CopyButton } from "@/components/copy-button";
import { Alert } from "@/components/ui/card";
import type { SecretState } from "./actions";

/** Create form that shows a newly created secret once, with a copy button. */
export function SecretForm({
  action,
  children,
  label,
}: {
  action: (p: SecretState, fd: FormData) => Promise<SecretState>;
  children: ReactNode;
  label: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const errors = Object.values(state.fieldErrors ?? {}).flat().filter(Boolean) as string[];
  return (
    <div className="space-y-3">
      {state.secret && (
        <Alert tone="success">
          <p className="mb-2">{state.message}</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-surface px-2 py-1 font-mono text-xs text-foreground" data-testid="new-secret">
              {state.secret}
            </code>
            <CopyButton value={state.secret} label="Copy" />
          </div>
        </Alert>
      )}
      {!state.ok && (state.message || errors.length > 0) && <Alert tone="danger">{errors.length ? errors.join(" · ") : state.message}</Alert>}
      <form action={formAction} aria-label={label} aria-busy={pending} className="space-y-3">
        <fieldset disabled={pending} className="contents">
          {children}
        </fieldset>
      </form>
    </div>
  );
}
