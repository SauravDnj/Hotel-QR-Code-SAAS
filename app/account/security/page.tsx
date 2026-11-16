import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { qrSvgDataUri } from "@/lib/qr/render";
import { formatDateTime } from "@/lib/utils";
import { mfaStatus, pendingEnrollment } from "@/modules/account/security";
import { beginMfaAction, confirmMfaAction, disableMfaAction } from "./actions";

export const metadata: Metadata = { title: "Two-step sign-in" };

export default async function AccountSecurityPage({ searchParams }: { searchParams: Promise<{ required?: string }> }) {
  const { required } = await searchParams;
  const user = await requireUser();
  const db = getDb();
  const status = await mfaStatus(db, user.id);
  const pending = status.enabled ? null : await pendingEnrollment(db, user.id);
  const qr = pending ? await qrSvgDataUri(pending.url) : null;

  return (
    <main className="mx-auto max-w-lg space-y-4 px-4 py-10">
      <Link href={user.isPlatformAdmin && status.enabled ? "/platform" : "/profile"} className="text-sm text-primary underline underline-offset-4">
        ← Back
      </Link>
      <h1 className="text-2xl font-semibold">Two-step sign-in</h1>
      {required && !status.enabled && (
        <Alert tone="warning">SaaS operators must turn on two-step sign-in before using the platform console.</Alert>
      )}
      <Card className="space-y-4">
        {status.enabled ? (
          <>
            <p className="text-sm">
              On since {status.enabledAt ? formatDateTime(status.enabledAt, "UTC") : "—"}. You&apos;ll be asked for a 6-digit code from your
              authenticator app each time you sign in.
            </p>
            {user.isPlatformAdmin ? (
              <p className="text-xs text-muted-foreground">Operators can&apos;t turn this off. If you lose your phone, ask another operator to reset it.</p>
            ) : (
              <ActionForm action={disableMfaAction} className="space-y-2 border-t border-border pt-4" aria-label="Turn off two-step sign-in">
                <p className="text-sm font-medium">Turn off</p>
                <Input name="password" type="password" placeholder="Password" aria-label="Password" autoComplete="current-password" required />
                <Input name="code" inputMode="numeric" placeholder="Current 6-digit code" aria-label="Authenticator code" autoComplete="one-time-code" required />
                <Button type="submit" variant="secondary">
                  Turn off two-step sign-in
                </Button>
              </ActionForm>
            )}
          </>
        ) : pending && qr ? (
          <>
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              <li>Open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…).</li>
              <li>Scan this code, or enter the key by hand.</li>
              <li>Type the 6-digit code it shows.</li>
            </ol>
            {/* eslint-disable-next-line @next/next/no-img-element -- inline data URI */}
            <img src={qr} alt="QR code for your authenticator app" className="mx-auto size-48 rounded-ui border border-border bg-white" />
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded bg-surface-muted px-2 py-1 text-xs" title="Setup key">
                {pending.secret}
              </code>
              <CopyButton value={pending.secret} label="Copy setup key" />
            </div>
            <ActionForm action={confirmMfaAction} className="flex flex-wrap items-end gap-2" aria-label="Confirm two-step sign-in">
              <Input name="code" inputMode="numeric" placeholder="123456" aria-label="Authenticator code" autoComplete="one-time-code" required className="w-36" />
              <Button type="submit">Turn on</Button>
            </ActionForm>
            <p className="text-xs text-muted-foreground">After turning it on you&apos;ll sign in again, this time with a code.</p>
          </>
        ) : (
          <>
            <p className="text-sm">
              Protect your account with a code from your phone in addition to your password. Recommended for owners and managers; required for SaaS
              operators.
            </p>
            <ActionForm action={beginMfaAction}>
              <Button type="submit">Set up two-step sign-in</Button>
            </ActionForm>
          </>
        )}
      </Card>
    </main>
  );
}
