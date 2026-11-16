import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { getDb } from "@/lib/db/client";
import { getResetToken } from "@/modules/account/security";
import { resetPasswordAction } from "./actions";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Set a new password", robots: { index: false, follow: false }, referrer: "same-origin" };

export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const row = await getResetToken(getDb(), token);
  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <Card>
        {row ? (
          <>
            <h1 className="text-xl font-semibold">Set a new password</h1>
            <p className="mt-1 text-sm text-muted-foreground">For {row.email}. You&apos;ll be signed out everywhere.</p>
            <ResetForm action={resetPasswordAction.bind(null, token)} />
          </>
        ) : (
          <div className="text-center">
            <h1 className="text-lg font-semibold">This link isn&apos;t valid</h1>
            <p className="mt-2 text-sm text-muted-foreground">Reset links work once, for one hour. Ask support for a new one.</p>
          </div>
        )}
      </Card>
    </main>
  );
}
