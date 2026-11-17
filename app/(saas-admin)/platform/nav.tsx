"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/platform", label: "Overview" },
  { href: "/platform/tenants", label: "Hotels" },
  { href: "/platform/users", label: "Users & staff" },
  { href: "/platform/plans", label: "Plans" },
  { href: "/platform/audit", label: "Audit log" },
  { href: "/platform/support", label: "Support" },
  { href: "/platform/docs", label: "Docs & guide" },
];

export function PlatformNav() {
  const path = usePathname();
  return (
    <nav aria-label="Super admin" className="flex gap-1 overflow-x-auto">
      {ITEMS.map((i) => {
        const active = i.href === "/platform" ? path === "/platform" : path.startsWith(i.href);
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "whitespace-nowrap rounded-ui px-3 py-2 text-sm hover:bg-surface-muted",
              active && "bg-surface-muted font-semibold text-primary",
            )}
          >
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
