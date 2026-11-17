import type { Metadata } from "next";
import { GuideView } from "@/components/guide/guide-view";
import { requireTenantContext } from "@/lib/auth/session";
import { propertyScope } from "@/lib/permissions/authorize";
import { HOTEL_GUIDE, sectionsFor } from "@/modules/help/content";

export const metadata: Metadata = { title: "Help & guide" };

/** Hotel guide, trimmed to the sections this person's role can actually use. */
export default async function HelpPage() {
  const ctx = await requireTenantContext();
  const has = (p: Parameters<typeof propertyScope>[1]) => {
    const s = propertyScope(ctx, p);
    return s === "all" || s.length > 0;
  };
  const guide = { ...HOTEL_GUIDE, sections: sectionsFor(HOTEL_GUIDE.sections, has) };
  return <GuideView guide={guide} />;
}
