import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { getProfile } from "@/modules/staff/profile";
import { propertyScope } from "@/lib/permissions/authorize";
import { vapidPublicKey } from "@/lib/notifications/senders";
import { formatDateTime } from "@/lib/utils";
import { listMyDevices } from "@/modules/notifications/service";
import {
  changePasswordAction,
  removeDeviceAction,
  subscribePushAction,
  testPushAction,
  unsubscribePushAction,
  updateNameAction,
  updatePrefsAction,
} from "./actions";
import { PushToggle } from "./push-toggle";

export const metadata: Metadata = { title: "My profile" };

export default async function ProfilePage() {
  const ctx = await requireTenantContext();
  const [p, devices] = await Promise.all([getProfile(getDb(), ctx), listMyDevices(getDb(), ctx)]);
  const publicKey = vapidPublicKey();
  const assignScope = propertyScope(ctx, "request.assign");
  const supervisor = assignScope === "all" || assignScope.length > 0;
  const roles = [...new Set(ctx.grants.map((g) => g.roleKey))].join(", ") || "none";

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My profile</h1>
        <p className="text-sm text-muted-foreground">
          {p.email} · {ctx.tenantName} · roles: {roles}
        </p>
      </div>

      <Card>
        <h2 className="mb-3 text-sm font-semibold">Name</h2>
        <ActionForm action={updateNameAction} className="flex flex-wrap items-end gap-2" aria-label="Name">
          <Input name="name" defaultValue={p.name} aria-label="Name" className="w-72" required />
          <Button type="submit" variant="secondary">
            Save
          </Button>
        </ActionForm>
      </Card>

      <Card>
        <h2 className="mb-1 text-sm font-semibold">Request notifications</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Applies to the Requests page on every device you use for this hotel. Browsers only play sounds after you have
          interacted with the page.
        </p>
        <ActionForm action={updatePrefsAction} className="space-y-3" aria-label="Notifications">
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" name="notifySound" defaultChecked={p.notifySound} className="size-4" />
            Play a sound for new requests
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Alert me for
            <Select name="notifyScope" defaultValue={p.notifyScope} className="w-72">
              <option value="all">Every new request I can see</option>
              <option value="mine">Only requests assigned to me</option>
            </Select>
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" name="notifyPush" defaultChecked={p.notifyPush} className="size-4" />
            Send phone notifications to my registered devices
          </label>
          {supervisor && (
            <fieldset className="space-y-2 rounded-ui border border-border p-3">
              <legend className="px-1 text-sm font-medium">Escalation alerts</legend>
              <p className="text-xs text-muted-foreground">
                When a request isn&apos;t accepted in time, also message me. Only the room and service are sent, never guest details.
              </p>
              <label className="flex flex-col gap-1 text-sm">
                Send by
                <Select name="escalationChannel" defaultValue={p.escalationChannel} className="w-72">
                  <option value="none">Don&apos;t message me</option>
                  <option value="sms">SMS</option>
                  <option value="whatsapp">WhatsApp</option>
                </Select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Work mobile (international format)
                <Input name="alertPhone" type="tel" defaultValue={p.alertPhone ?? ""} placeholder="+919876543210" className="w-72" />
              </label>
            </fieldset>
          )}
          <Button type="submit" variant="secondary">
            Save notifications
          </Button>
        </ActionForm>
      </Card>

      <Card className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Phone notifications</h2>
          <p className="text-xs text-muted-foreground">
            Get an alert for new and escalated requests even when the Requests page is closed. Turn it on separately on each phone or
            computer you use.
          </p>
        </div>
        {publicKey ? (
          <PushToggle publicKey={publicKey} subscribe={subscribePushAction} unsubscribe={unsubscribePushAction} />
        ) : (
          <p className="text-sm text-muted-foreground">Phone notifications aren&apos;t set up for this service yet. The Requests page still alerts you.</p>
        )}
        {devices.length > 0 && (
          <ul className="divide-y divide-border rounded-ui border border-border text-sm" aria-label="My devices">
            {devices.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span>
                  {d.label ?? "Device"}
                  <span className="block text-xs text-muted-foreground">
                    Added {formatDateTime(d.createdAt, p.timezone)}
                    {d.lastSuccessAt ? ` · last alert ${formatDateTime(d.lastSuccessAt, p.timezone)}` : ""}
                  </span>
                </span>
                <ActionForm action={removeDeviceAction.bind(null, d.id)} aria-label={`Remove ${d.label ?? "device"}`}>
                  <Button type="submit" size="sm" variant="ghost">
                    Remove
                  </Button>
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
        {publicKey && devices.length > 0 && (
          <ActionForm action={testPushAction} aria-label="Test notification">
            <Button type="submit" size="sm" variant="secondary">
              Send a test notification
            </Button>
          </ActionForm>
        )}
      </Card>

      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Two-step sign-in</h2>
          <p className="text-xs text-muted-foreground">A code from your phone in addition to your password. Recommended for owners and managers.</p>
        </div>
        <Link href="/account/security" className="text-sm font-medium text-primary underline underline-offset-4">
          Manage →
        </Link>
      </Card>

      <Card>
        <h2 className="mb-1 text-sm font-semibold">Change password</h2>
        <p className="mb-3 text-xs text-muted-foreground">You&apos;ll be signed out everywhere and asked to sign in again.</p>
        <ActionForm action={changePasswordAction} className="flex flex-wrap items-end gap-2" aria-label="Change password">
          <Input name="currentPassword" type="password" placeholder="Current password" aria-label="Current password" autoComplete="current-password" required className="w-56" />
          <Input name="newPassword" type="password" placeholder="New password (10+ characters)" aria-label="New password" autoComplete="new-password" required minLength={10} className="w-64" />
          <Button type="submit">Change password</Button>
        </ActionForm>
      </Card>
    </div>
  );
}
