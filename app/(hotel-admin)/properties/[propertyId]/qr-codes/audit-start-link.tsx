"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/** Starts an audit "now" (the start time is taken when clicked, then kept in the URL). */
export function AuditStartLink({ href }: { href: string }) {
  const router = useRouter();
  return (
    <Button type="button" variant="secondary" size="sm" onClick={() => router.push(href + encodeURIComponent(new Date().toISOString()))}>
      Start room-by-room audit
    </Button>
  );
}
