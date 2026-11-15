"use client";

import { useActionState, useState, type ReactNode } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import type { ActionState } from "@/lib/actions";
import { cn } from "@/lib/utils";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Small form for inline create/edit/archive actions. Shows the server's message and
 * field errors next to the form. Every action re-authorises on the server.
 */
export function ActionForm({
  action,
  children,
  className,
  "aria-label": ariaLabel,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const errors = Object.values(state.fieldErrors ?? {}).flat().filter(Boolean) as string[];
  return (
    <div className="min-w-0">
      <form action={formAction} className={className} aria-label={ariaLabel} aria-busy={pending}>
        <fieldset disabled={pending} className="contents">
          {children}
        </fieldset>
      </form>
      {(state.message || errors.length > 0) && (
        <p role={state.ok ? "status" : "alert"} className={cn("mt-1 text-xs", state.ok ? "text-success" : "text-danger")}>
          {errors.length ? errors.join(" · ") : state.message}
        </p>
      )}
    </div>
  );
}

/** Two-step confirmation for destructive actions; no browser dialogs. */
export function ConfirmButton({ children, confirmLabel = "Confirm", ...props }: ButtonProps & { confirmLabel?: string }) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <Button type="button" {...props} onClick={() => setArmed(true)}>
        {children}
      </Button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <Button {...props} type="submit" variant="danger">
        {confirmLabel}
      </Button>
      <Button type="button" size={props.size} variant="ghost" onClick={() => setArmed(false)}>
        Cancel
      </Button>
    </span>
  );
}
