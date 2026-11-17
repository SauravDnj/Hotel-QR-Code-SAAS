import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SYSTEM_ROLES } from "@/lib/permissions/catalog";
import { HOTEL_GUIDE, PLATFORM_GUIDE, sectionsFor } from "@/modules/help/content";
import { guideToMarkdown } from "@/modules/help/markdown";

/** Every static page route under app/, as URL paths (route groups stripped). */
function appRoutes(): Set<string> {
  const out = new Set<string>();
  const walk = (dir: string, url: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const seg = e.name.startsWith("(") ? "" : `/${e.name}`;
      const next = join(dir, e.name);
      if (existsSync(join(next, "page.tsx"))) out.add(url + seg || "/");
      walk(next, url + seg);
    }
  };
  walk(join(process.cwd(), "app"), "");
  return out;
}

describe("in-app guide content", () => {
  const routes = appRoutes();

  for (const guide of [HOTEL_GUIDE, PLATFORM_GUIDE]) {
    it(`${guide.key} guide: unique ids, valid journey and links to real pages`, () => {
      const ids = guide.sections.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const j of guide.journey) expect(ids).toContain(j.section);
      for (const s of guide.sections) {
        expect(s.blocks.length).toBeGreaterThan(0);
        for (const b of s.blocks) {
          if (b.kind === "links") for (const l of b.items) expect(routes, `${s.id} → ${l.href}`).toContain(l.href);
          if (b.kind === "table") for (const r of b.rows) expect(r).toHaveLength(b.head.length);
          if (b.kind === "media")
            for (const m of b.items) expect(existsSync(join(process.cwd(), "public", m.src)), `${s.id} → ${m.src}`).toBe(true);
        }
      }
    });
  }

  it("shows each role only the sections it can use", () => {
    const titlesFor = (role: keyof typeof SYSTEM_ROLES) => {
      const perms = new Set<string>(SYSTEM_ROLES[role].permissions);
      return sectionsFor(HOTEL_GUIDE.sections, (p) => perms.has(p)).map((s) => s.id);
    };
    expect(titlesFor("owner")).toEqual(HOTEL_GUIDE.sections.map((s) => s.id));
    const housekeeping = titlesFor("housekeeping");
    expect(housekeeping).toContain("housekeeping");
    expect(housekeeping).toContain("faq");
    expect(housekeeping).not.toContain("billing");
    expect(housekeeping).not.toContain("staff");
    expect(titlesFor("receptionist")).toContain("front-desk");
  });

  it("docs/*.md match the in-app guide (run `pnpm guide:md` after editing content.ts)", () => {
    const read = (f: string) => readFileSync(join(process.cwd(), "docs", f), "utf8").replace(/\r\n/g, "\n");
    expect(read("HOTEL_GUIDE.md")).toBe(guideToMarkdown(HOTEL_GUIDE, { roles: true }));
    expect(read("SUPER_ADMIN_GUIDE.md")).toBe(guideToMarkdown(PLATFORM_GUIDE));
  });
});
