/**
 * Creates (or promotes) a SaaS platform operator.
 *
 *   pnpm platform:admin -- --email ops@example.com --name "Ops Admin"
 *
 * The password is read from the PLATFORM_ADMIN_PASSWORD environment variable so it never
 * appears in shell history or process lists. It is only used when creating a new user.
 */
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { users } from "../lib/db/schema";
import { hashPassword, normalizeEmail, PASSWORD_MIN_LENGTH } from "../lib/auth/password";
import { writeAudit } from "../modules/audit/service";
import { scriptDb } from "./db";

const { values } = parseArgs({
  options: { email: { type: "string" }, name: { type: "string" } },
});
if (!values.email) throw new Error("--email is required");
const email = normalizeEmail(values.email);

const { db, close } = scriptDb();
try {
  const [existing] = await db.select().from(users).where(eq(users.email, email));
  if (existing) {
    // Bump session version so any existing session re-authenticates with new privileges.
    await db
      .update(users)
      .set({ isPlatformAdmin: true, sessionVersion: existing.sessionVersion + 1 })
      .where(eq(users.id, existing.id));
    await writeAudit(db, {
      tenantId: null,
      actorUserId: null,
      actorType: "system",
      action: "platform_admin.granted",
      entityType: "user",
      entityId: existing.id,
    });
    console.log(`Promoted existing user ${email} to platform admin.`);
  } else {
    const password = process.env.PLATFORM_ADMIN_PASSWORD;
    if (!password || password.length < PASSWORD_MIN_LENGTH) {
      throw new Error(`Set PLATFORM_ADMIN_PASSWORD (min ${PASSWORD_MIN_LENGTH} characters) to create a new admin.`);
    }
    const [user] = await db
      .insert(users)
      .values({
        email,
        name: values.name ?? "Platform Admin",
        passwordHash: await hashPassword(password),
        isPlatformAdmin: true,
      })
      .returning({ id: users.id });
    await writeAudit(db, {
      tenantId: null,
      actorUserId: null,
      actorType: "system",
      action: "platform_admin.created",
      entityType: "user",
      entityId: user.id,
    });
    console.log(`Created platform admin ${email}.`);
  }
} finally {
  await close();
}
