"use client";

import { useActionState } from "react";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { inviteAction, type InviteState } from "./actions";

export function InviteForm({
  roles,
  scopes,
}: {
  roles: { id: string; name: string }[];
  scopes: { value: string; label: string }[];
}) {
  const [state, action, pending] = useActionState<InviteState, FormData>(inviteAction, {});
  const e = state.fieldErrors ?? {};
  return (
    <div className="space-y-3">
      <form action={action} className="grid gap-3 sm:grid-cols-2" aria-label="Invite staff">
        <label className="flex flex-col gap-1 text-sm">
          Name
          <Input name="name" required maxLength={120} invalid={!!e.name} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Email
          <Input name="email" type="email" required invalid={!!e.email} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Role
          <Select name="roleId" required defaultValue="">
            <option value="" disabled>
              Choose…
            </option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Where
          <Select name="scope" defaultValue={scopes[0]?.value ?? ""}>
            {scopes.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </label>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create invitation link"}
          </Button>
        </div>
      </form>
      {state.message && (
        <div role={state.ok ? "status" : "alert"} className={state.ok ? "space-y-2 rounded-ui bg-success-surface p-3 text-sm" : "text-sm text-danger"}>
          <p>{Object.values(e).flat().filter(Boolean)[0] ?? state.message}</p>
          {state.link && (
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 max-w-full truncate rounded bg-surface px-2 py-1 text-xs" title="Invitation link">
                {state.link}
              </code>
              <CopyButton value={state.link} label="Copy invitation link" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
