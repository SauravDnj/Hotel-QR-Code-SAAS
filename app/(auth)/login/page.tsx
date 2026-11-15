import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getCurrentUser()) redirect("/dashboard");
  const { next } = await searchParams;
  return (
    <Card className="p-6 sm:p-8">
      <h1 className="text-xl font-semibold">Sign in</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">Hotel staff and administrators.</p>
      <LoginForm next={next} />
      <p className="mt-6 text-center text-sm text-muted-foreground">
        New hotel?{" "}
        <Link href="/signup" className="font-medium text-primary underline-offset-4 hover:underline">
          Create an account
        </Link>
      </p>
    </Card>
  );
}
