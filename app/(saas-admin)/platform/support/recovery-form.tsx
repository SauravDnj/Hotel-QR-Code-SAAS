"use client";

import { useActionState } from "react";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import type { LinkState } from "./actions";

export function RecoveryForm({
  action,
  label,
  submit,
}: {
  action: (p: LinkState, fd: FormData) => Promise<LinkState>;
  label: string;
  submit: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-2" aria-label={label}>
      <Input name="email" type="email" placeholder="person@hotel.com" aria-label={`${label}: email`} required />
      <Input name="reason" placeholder="How you verified them / ticket ref (audited)" aria-label={`${label}: reason`} required />
      <Button type="submit" size="sm" disabled={pending}>
        {submit}
      </Button>
      {state.message && (
        <div role={state.ok ? "status" : "alert"} className={state.ok ? "space-y-1 text-sm text-success" : "text-sm text-danger"}>
          <p>{state.message}</p>
          {state.link && (
            <div className="flex flex-wrap items-center gap-2">
              <code className="max-w-full truncate rounded bg-surface-muted px-2 py-1 text-xs text-foreground" title="Reset link">
                {state.link}
              </code>
              <CopyButton value={state.link} label="Copy reset link" />
            </div>
          )}
        </div>
      )}
    </form>
  );
}
