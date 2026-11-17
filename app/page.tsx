import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/session";

export default async function Home() {
  const user = await getCurrentUser();
  // Super admins land on the SaaS console; hotel staff on their dashboard.
  if (user) redirect(user.isPlatformAdmin ? "/platform" : "/dashboard");
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-16">
      <p className="text-sm font-medium uppercase tracking-widest text-accent">Hotel SaaS</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
        Every room, a connected service point.
      </h1>
      <p className="mt-4 max-w-xl text-lg text-muted-foreground">
        Guests scan the QR code in their room to request water, housekeeping, maintenance or reception, with no app
        needed. Your team gets clear, room-specific requests in real time.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/signup" className={buttonVariants()}>
          Create hotel account
        </Link>
        <Link href="/login" className={buttonVariants({ variant: "secondary" })}>
          Staff sign in
        </Link>
      </div>
    </main>
  );
}
