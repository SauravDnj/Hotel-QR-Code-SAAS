"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import type { ActionState } from "@/lib/actions";

type Values = Record<string, string | undefined>;

interface Props {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  initial: Values;
  hasWifiPassword: boolean;
  sections: number;
  readOnly?: boolean;
}

const textarea =
  "block w-full rounded-ui border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground aria-[invalid=true]:border-danger";

function Check({ name, label, hint, checked }: { name: string; label: string; hint?: string; checked: boolean }) {
  return (
    <label className="flex min-h-11 items-start gap-3 text-sm">
      <input type="checkbox" name={name} defaultChecked={checked} className="mt-1 size-4" />
      <span>
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

export function PortalForm({ action, initial, hasWifiPassword, sections, readOnly }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const v: Values = state.values ?? initial;
  const e = state.fieldErrors ?? {};
  const on = (k: string) => v[k] === "on";

  return (
    <form action={formAction} className="space-y-6" noValidate aria-label="Guest portal settings">
      {state.message && <Alert tone={state.ok ? "success" : "danger"}>{state.message}</Alert>}
      <fieldset disabled={readOnly || pending} className="space-y-6">
        <Card className="space-y-4">
          <h3 className="text-sm font-semibold">Portal</h3>
          <Check
            name="enabled"
            label="Guest portal is on"
            hint="When off, every room QR shows an “unavailable” page."
            checked={on("enabled")}
          />
          <Check
            name="showRoomLabel"
            label="Show the room number to guests"
            hint="Helps guests confirm they scanned the right room."
            checked={on("showRoomLabel")}
          />
          <Field label="Welcome message" name="welcomeMessage" error={e.welcomeMessage} hint="Up to 300 characters.">
            <textarea
              id="welcomeMessage"
              name="welcomeMessage"
              rows={2}
              maxLength={300}
              defaultValue={v.welcomeMessage ?? ""}
              className={textarea}
            />
          </Field>
        </Card>

        <Card className="space-y-4">
          <h3 className="text-sm font-semibold">Wi-Fi</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Network name (SSID)" name="wifiSsid" error={e.wifiSsid}>
              <Input name="wifiSsid" maxLength={32} autoComplete="off" defaultValue={v.wifiSsid ?? ""} invalid={!!e.wifiSsid} />
            </Field>
            <Field
              label="Wi-Fi password"
              name="wifiPassword"
              error={e.wifiPassword}
              hint={hasWifiPassword ? "A password is saved. Leave blank to keep it." : "Leave blank for an open network."}
            >
              <Input
                name="wifiPassword"
                type="password"
                maxLength={63}
                autoComplete="new-password"
                placeholder={hasWifiPassword ? "••••••••" : ""}
                invalid={!!e.wifiPassword}
              />
            </Field>
          </div>
          {hasWifiPassword && <Check name="clearWifiPassword" label="Remove the saved password" checked={false} />}
          <Field label="Wi-Fi note" name="wifiNote" error={e.wifiNote} hint="e.g. “Use Hotel-5G in rooms above floor 3”.">
            <Input name="wifiNote" maxLength={200} defaultValue={v.wifiNote ?? ""} />
          </Field>
          <p className="text-xs text-muted-foreground">
            The password is encrypted when stored and only shown on this hotel&apos;s guest page. Use a separate guest network
            with client isolation on your router.
          </p>
        </Card>

        <Card className="space-y-4">
          <h3 className="text-sm font-semibold">Contact and stay times</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Reception phone" name="receptionPhone" error={e.receptionPhone}>
              <Input name="receptionPhone" type="tel" defaultValue={v.receptionPhone ?? ""} invalid={!!e.receptionPhone} />
            </Field>
            <Field label="Guest contact email" name="contactEmail" error={e.contactEmail}>
              <Input name="contactEmail" type="email" defaultValue={v.contactEmail ?? ""} invalid={!!e.contactEmail} />
            </Field>
            <Field label="Check-in from" name="checkInTime" error={e.checkInTime}>
              <Input name="checkInTime" type="time" defaultValue={v.checkInTime ?? ""} invalid={!!e.checkInTime} />
            </Field>
            <Field label="Check-out by" name="checkOutTime" error={e.checkOutTime}>
              <Input name="checkOutTime" type="time" defaultValue={v.checkOutTime ?? ""} invalid={!!e.checkOutTime} />
            </Field>
          </div>
        </Card>

        <Card className="space-y-4">
          <h3 className="text-sm font-semibold">Branding</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Accent colour" name="accentColor" error={e.accentColor} hint="Hex, e.g. #1E3A5F. Blank = default.">
              <Input name="accentColor" placeholder="#1E3A5F" defaultValue={v.accentColor ?? ""} invalid={!!e.accentColor} />
            </Field>
            <Field label="Logo image URL" name="logoUrl" error={e.logoUrl} hint="https:// link to a PNG/SVG.">
              <Input name="logoUrl" type="url" defaultValue={v.logoUrl ?? ""} invalid={!!e.logoUrl} />
            </Field>
            <Field label="Cover image URL" name="coverImageUrl" error={e.coverImageUrl} hint="Optional wide photo.">
              <Input name="coverImageUrl" type="url" defaultValue={v.coverImageUrl ?? ""} invalid={!!e.coverImageUrl} />
            </Field>
          </div>
        </Card>

        <Card className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold">Hotel information</h3>
            <p className="text-xs text-muted-foreground">
              Facilities, dining times, policies… Shown as expandable sections. Leave unused rows empty.
            </p>
          </div>
          {e.infoSections && <p className="text-xs text-danger">{e.infoSections[0]}</p>}
          {Array.from({ length: sections }, (_, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[14rem_1fr]">
              <Input
                name={`sectionTitle${i}`}
                aria-label={`Section ${i + 1} title`}
                placeholder={["Breakfast", "Swimming pool", "House rules"][i] ?? "Title"}
                maxLength={60}
                defaultValue={v[`sectionTitle${i}`] ?? ""}
              />
              <textarea
                name={`sectionBody${i}`}
                aria-label={`Section ${i + 1} text`}
                rows={2}
                maxLength={1000}
                defaultValue={v[`sectionBody${i}`] ?? ""}
                className={textarea}
              />
            </div>
          ))}
          <Field label="Privacy notice" name="privacyNotice" error={e.privacyNotice} hint="Shown at the bottom of the guest page.">
            <textarea
              id="privacyNotice"
              name="privacyNotice"
              rows={2}
              maxLength={1000}
              defaultValue={v.privacyNotice ?? ""}
              className={textarea}
            />
          </Field>
        </Card>
      </fieldset>
      {!readOnly && (
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save guest portal"}
        </Button>
      )}
    </form>
  );
}
