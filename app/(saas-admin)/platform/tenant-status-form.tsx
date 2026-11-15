"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { setTenantStatusAction } from "./actions";

export function TenantStatusForm({ tenantId, suspended }: { tenantId: string; suspended: boolean }) {
  const [state, action, pending] = useActionState(setTenantStatusAction, {});
  const target = suspended ? "active" : "suspended";
  return (
    <form action={action} className="flex min-w-64 flex-col gap-2">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="status" value={target} />
      <label className="sr-only" htmlFor={`reason-${tenantId}`}>
        Reason
      </label>
      <input
        id={`reason-${tenantId}`}
        name="reason"
        required
        minLength={3}
        placeholder="Reason (required, audited)"
        className="min-h-9 rounded-ui border border-border bg-surface px-2 text-xs"
      />
      <Button size="sm" variant={suspended ? "secondary" : "danger"} type="submit" disabled={pending}>
        {suspended ? "Reactivate" : "Suspend"}
      </Button>
      {state.message && (
        <p className={state.ok ? "text-xs text-success" : "text-xs text-danger"} role="status">
          {state.message}
        </p>
      )}
    </form>
  );
}
