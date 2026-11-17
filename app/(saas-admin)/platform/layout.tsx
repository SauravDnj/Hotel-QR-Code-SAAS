import Link from "next/link";
import { logoutAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { requirePlatformAdmin } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { listUserTenants } from "@/modules/tenants/context";
import { PlatformNav } from "./nav";

/** SaaS super admin shell. Every page and action below re-checks platform admin + two-step sign-in. */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const actor = await requirePlatformAdmin();
  const ownHotels = await listUserTenants(getDb(), actor.id);
  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">Super admin</span>
            <span className="text-sm text-muted-foreground">SaaS console · every action is audited</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden truncate text-muted-foreground sm:inline">{actor.email}</span>
            {ownHotels.length > 0 && (
              <Link href="/dashboard" className="text-primary underline underline-offset-4">
                My hotel workspace
              </Link>
            )}
            <Link href="/account/security" className="text-primary underline underline-offset-4">
              Security
            </Link>
            <form action={logoutAction}>
              <Button variant="secondary" size="sm" type="submit">
                Sign out
              </Button>
            </form>
          </div>
        </div>
        <div className="mx-auto max-w-6xl px-3 pb-2">
          <PlatformNav />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>
    </div>
  );
}
