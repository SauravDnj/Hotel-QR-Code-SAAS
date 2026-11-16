import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Alert, Card } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; changed?: string; mfa?: string }> }) {
  if (await getCurrentUser()) redirect("/dashboard");
  const { next, changed, mfa } = await searchParams;
  return (
    <Card className="p-6 sm:p-8">
      <h1 className="text-xl font-semibold">Sign in</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">Hotel staff and administrators.</p>
      {changed && <Alert tone="success" className="mb-4">Password changed. Please sign in with your new password.</Alert>}
      {mfa && <Alert tone="success" className="mb-4">Two-step sign-in is on. Sign in with your password and authenticator code.</Alert>}
      <LoginForm next={next} />
      <p className="mt-6 text-center text-sm text-muted-foreground">
        New hotel?{" "}
        <Link href="/signup" className="font-medium text-primary underline underline-offset-4">
          Create an account
        </Link>
      </p>
    </Card>
  );
}
