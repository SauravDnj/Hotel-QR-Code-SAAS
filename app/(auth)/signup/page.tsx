import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth/session";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Create hotel account" };

export default async function SignupPage() {
  if (await getCurrentUser()) redirect("/dashboard");
  return (
    <Card className="p-6 sm:p-8">
      <h1 className="text-xl font-semibold">Create your hotel account</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">
        Start a free trial. You will be the owner of this hotel account.
      </p>
      <SignupForm />
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </Card>
  );
}
