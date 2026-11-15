import Link from "next/link";
import { logoutAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { requireTenantContext, requireUser } from "@/lib/auth/session";
import { can } from "@/lib/permissions/authorize";
import type { PermissionKey } from "@/lib/permissions/catalog";

const NAV: { href: string; label: string; permission?: PermissionKey }[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/properties", label: "Properties", permission: "property.view" },
  { href: "/settings", label: "Hotel settings", permission: "tenant.manage" },
  { href: "/audit", label: "Audit log", permission: "audit.view" },
];

export default async function HotelAdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const ctx = await requireTenantContext();
  // Navigation hiding is cosmetic; every page and action re-checks on the server.
  const items = NAV.filter((n) => !n.permission || can(ctx, n.permission));
  const inactive = ctx.tenantStatus === "suspended" || ctx.tenantStatus === "cancelled";

  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_1fr]">
      <aside className="border-b border-border bg-surface md:min-h-screen md:border-b-0 md:border-r">
        <div className="px-5 py-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Hotel</p>
          <p className="truncate font-semibold" title={ctx.tenantName}>
            {ctx.tenantName}
          </p>
        </div>
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col">
          {items.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="whitespace-nowrap rounded-ui px-3 py-2 text-sm hover:bg-surface-muted"
            >
              {n.label}
            </Link>
          ))}
          {user.isPlatformAdmin && (
            <Link href="/platform" className="whitespace-nowrap rounded-ui px-3 py-2 text-sm hover:bg-surface-muted">
              Platform console
            </Link>
          )}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="flex items-center justify-end gap-3 border-b border-border bg-surface px-5 py-3">
          <span className="truncate text-sm text-muted-foreground">{user.email}</span>
          <Link href="/select-tenant" className="text-sm text-primary underline-offset-4 hover:underline">
            Switch hotel
          </Link>
          <form action={logoutAction}>
            <Button variant="secondary" size="sm" type="submit">
              Sign out
            </Button>
          </form>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8">
          {inactive && (
            <Alert tone="warning" className="mb-6">
              This hotel account is {ctx.tenantStatus}. You can view information, but changes are disabled. Contact
              support to reactivate.
            </Alert>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
