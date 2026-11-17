// Writes the in-app guide as Markdown: docs/HOTEL_GUIDE.md and docs/SUPER_ADMIN_GUIDE.md.
// Usage: pnpm guide:md   (run after editing modules/help/content.ts)
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { HOTEL_GUIDE, PLATFORM_GUIDE } from "../modules/help/content";
import { guideToMarkdown } from "../modules/help/markdown";

const docs = join(process.cwd(), "docs");
writeFileSync(join(docs, "HOTEL_GUIDE.md"), guideToMarkdown(HOTEL_GUIDE, { roles: true }));
writeFileSync(join(docs, "SUPER_ADMIN_GUIDE.md"), guideToMarkdown(PLATFORM_GUIDE));
console.log("Wrote docs/HOTEL_GUIDE.md and docs/SUPER_ADMIN_GUIDE.md");
