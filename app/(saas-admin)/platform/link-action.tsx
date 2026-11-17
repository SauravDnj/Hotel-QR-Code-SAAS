"use client";

import { useActionState } from "react";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import type { LinkState } from "./support/actions";

/** Per-person recovery action (reset link / reset two-step) with an audited reason. */
export function LinkAction({
  action,
  email,
  submit,
  variant = "secondary",
}: {
  action: (p: LinkState, fd: FormData) => Promise<LinkState>;
  email: string;
  submit: string;
  variant?: "secondary" | "danger";
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <div className="min-w-0">
      <form action={formAction} className="flex flex-wrap items-center gap-1" aria-label={`${submit} for ${email}`}>
        <input type="hidden" name="email" value={email} />
        <input
          name="reason"
          required
          minLength={3}
          aria-label={`Reason to ${submit.toLowerCase()} for ${email}`}
          placeholder="Reason (audited)"
          className="min-h-9 w-40 rounded-ui border border-border bg-surface px-2 text-xs"
        />
        <Button type="submit" size="sm" variant={variant} disabled={pending}>
          {submit}
        </Button>
      </form>
      {state.message && (
        <div role={state.ok ? "status" : "alert"} className={state.ok ? "mt-1 space-y-1 text-xs text-success" : "mt-1 text-xs text-danger"}>
          <p>{state.message}</p>
          {state.link && (
            <div className="flex flex-wrap items-center gap-2">
              <code className="max-w-64 truncate rounded bg-surface-muted px-2 py-1 text-foreground" title="Reset link">
                {state.link}
              </code>
              <CopyButton value={state.link} label="Copy link" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
