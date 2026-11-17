import type { Metadata } from "next";
import { GuideView } from "@/components/guide/guide-view";
import { requirePlatformAdmin } from "@/lib/auth/session";
import { HOTEL_GUIDE, PLATFORM_GUIDE } from "@/modules/help/content";

export const metadata: Metadata = { title: "Docs & guide" };

/** Super admin docs: the platform guide plus the complete hotel guide (every section, every role). */
export default async function PlatformDocsPage({ searchParams }: { searchParams: Promise<{ guide?: string }> }) {
  await requirePlatformAdmin();
  const hotel = (await searchParams).guide === "hotel";
  const tabs = [
    { href: "/platform/docs", label: "Super admin guide", active: !hotel },
    { href: "/platform/docs?guide=hotel", label: "Hotel guide (all roles)", active: hotel },
  ];
  // Hotel-page shortcuts would need a hotel workspace; enter one from Hotels → Manage instead.
  return hotel ? <GuideView guide={HOTEL_GUIDE} tabs={tabs} showLinks={false} /> : <GuideView guide={PLATFORM_GUIDE} tabs={tabs} />;
}
