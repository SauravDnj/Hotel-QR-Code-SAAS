import Link from "next/link";
import { logoutAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { requireTenantContext, requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { can, propertyScope } from "@/lib/permissions/authorize";
import { inboxMarker } from "@/modules/requests/staff";
import { ServiceWorkerRegister } from "@/components/sw-register";
import type { PermissionKey } from "@/lib/permissions/catalog";

const NAV: { href: string; label: string; permission?: PermissionKey; anyProperty?: boolean }[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/front-desk", label: "Front desk", permission: "stay.view", anyProperty: true },
  { href: "/housekeeping", label: "Housekeeping", permission: "housekeeping.view", anyProperty: true },
  { href: "/rooms", label: "Rooms" },
  { href: "/properties", label: "Properties" },
  { href: "/staff", label: "Staff", permission: "staff.view" },
  { href: "/settings", label: "Hotel settings", permission: "tenant.manage" },
  { href: "/audit", label: "Audit log", permission: "audit.view" },
];

export default async function HotelAdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const ctx = await requireTenantContext();
  // Navigation hiding is cosmetic; every page and action re-checks on the server.
  const items = NAV.filter((n) => {
    if (!n.permission) return true;
    if (!n.anyProperty) return can(ctx, n.permission);
    const s = propertyScope(ctx, n.permission);
    return s === "all" || s.length > 0;
  });
  const requestScope = propertyScope(ctx, "request.view");
  const showInbox = requestScope === "all" || requestScope.length > 0;
  const marker = showInbox ? await inboxMarker(getDb(), ctx) : null;
  const newRequests = marker?.newCount ?? 0;
  const escalated = marker?.escalatedCount ?? 0;
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
          {showInbox && (
            <Link
              href="/inbox"
              className="flex items-center justify-between gap-2 whitespace-nowrap rounded-ui px-3 py-2 text-sm font-medium hover:bg-surface-muted"
            >
              Requests
              {escalated > 0 && (
                <span className="rounded-full bg-danger px-2 py-0.5 text-xs text-white" aria-label={`${escalated} escalated`} title="Escalated: not accepted in time">
                  {escalated}!
                </span>
              )}
              {newRequests > 0 && (
                <span className="rounded-full bg-accent px-2 py-0.5 text-xs text-accent-foreground" aria-label={`${newRequests} new`}>
                  {newRequests}
                </span>
              )}
            </Link>
          )}
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
          <Link href="/profile" className="truncate text-sm text-muted-foreground underline-offset-4 hover:underline" title="My profile">
            {user.name || user.email}
          </Link>
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
        <ServiceWorkerRegister />
      </div>
    </div>
  );
}
