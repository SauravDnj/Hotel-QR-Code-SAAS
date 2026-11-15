import { beforeAll, describe, expect, it } from "vitest";
import { count, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/types";
import { auditLogs, tenants, users } from "@/lib/db/schema";
import { verifyCredentials } from "@/lib/auth/credentials";
import { consumeRateLimit } from "@/lib/rate-limit";
import { createTenantWithOwner } from "@/modules/tenants/onboarding";
import { listTenantsForPlatform, setTenantStatus } from "@/modules/platform/service";
import { loadTenantContext } from "@/modules/tenants/context";
import { seedRbac } from "@/modules/rbac/seed";
import { createTestDb, signupInput } from "../helpers/db";

describe("onboarding", () => {
  let db: Db;
  beforeAll(async () => {
    db = await createTestDb();
  });

  it("creates tenant, owner, membership, owner role and first property", async () => {
    const r = await createTenantWithOwner(db, signupInput({ hotelName: "Sea View" }));
    const ctx = await loadTenantContext(db, r.userId, r.tenantId);
    expect(ctx?.tenantStatus).toBe("trialing");
    expect(ctx?.grants.map((g) => g.roleKey)).toEqual(["owner"]);
    const audit = await db.select().from(auditLogs).where(eq(auditLogs.tenantId, r.tenantId));
    expect(audit.map((a) => a.action)).toContain("tenant.created");
  });

  it("rejects a duplicate email and leaves no partial tenant behind", async () => {
    const input = signupInput({ hotelName: "Duplicate Inn" });
    await createTenantWithOwner(db, input);
    const before = (await db.select({ n: count() }).from(tenants))[0].n;
    await expect(createTenantWithOwner(db, { ...input, hotelName: "Other" })).rejects.toMatchObject({ code: "conflict" });
    const after = (await db.select({ n: count() }).from(tenants))[0].n;
    expect(after).toBe(before);
  });

  it("gives unique slugs to hotels with the same name", async () => {
    const a = await createTenantWithOwner(db, signupInput({ hotelName: "Same Name" }));
    const b = await createTenantWithOwner(db, signupInput({ hotelName: "Same Name" }));
    const rows = await db.select({ id: tenants.id, slug: tenants.slug }).from(tenants);
    const slugA = rows.find((t) => t.id === a.tenantId)!.slug;
    const slugB = rows.find((t) => t.id === b.tenantId)!.slug;
    expect(slugA).not.toBe(slugB);
  });

  it("validates input on the server", async () => {
    await expect(createTenantWithOwner(db, signupInput({ timezone: "Mars/Olympus" }))).rejects.toThrow();
    await expect(createTenantWithOwner(db, signupInput({ password: "short" }))).rejects.toThrow();
  });

  it("RBAC seed is idempotent", async () => {
    await expect(seedRbac(db)).resolves.toBeUndefined();
  });
});

describe("credentials", () => {
  let db: Db;
  const input = signupInput();
  beforeAll(async () => {
    db = await createTestDb();
    await createTenantWithOwner(db, input);
  });

  it("accepts the right password (email is case-insensitive)", async () => {
    const r = await verifyCredentials(db, { email: input.email.toUpperCase(), password: input.password }, "1.1.1.1");
    expect(r.ok).toBe(true);
  });

  it("gives the same answer for wrong password and unknown email", async () => {
    const wrong = await verifyCredentials(db, { email: input.email, password: "nope-nope-nope" }, "1.1.1.2");
    const unknown = await verifyCredentials(db, { email: "nobody@example.test", password: "x" }, "1.1.1.2");
    expect(wrong).toEqual({ ok: false, reason: "invalid" });
    expect(unknown).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects disabled users", async () => {
    await db.update(users).set({ status: "disabled" }).where(eq(users.email, input.email));
    const r = await verifyCredentials(db, { email: input.email, password: input.password }, "1.1.1.3");
    expect(r.ok).toBe(false);
    await db.update(users).set({ status: "active" }).where(eq(users.email, input.email));
  });

  it("rate-limits repeated attempts for one email", async () => {
    const email = "target@example.test";
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await verifyCredentials(db, { email, password: "x" }, `9.9.9.${i}`));
    expect(results.at(-1)).toEqual({ ok: false, reason: "rate_limited" });
  });

  it("rate-limit window resets", async () => {
    const rule = { limit: 1, windowSeconds: 60 };
    const t0 = new Date("2026-01-01T00:00:00Z");
    expect((await consumeRateLimit(db, "k", rule, t0)).allowed).toBe(true);
    expect((await consumeRateLimit(db, "k", rule, t0)).allowed).toBe(false);
    expect((await consumeRateLimit(db, "k", rule, new Date(t0.getTime() + 61_000))).allowed).toBe(true);
  });
});

describe("platform operator", () => {
  let db: Db;
  beforeAll(async () => {
    db = await createTestDb();
  });

  it("non-operators cannot list or suspend tenants", async () => {
    const r = await createTenantWithOwner(db, signupInput());
    const actor = { userId: r.userId, isPlatformAdmin: false };
    await expect(listTenantsForPlatform(db, actor)).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      setTenantStatus(db, actor, { tenantId: r.tenantId, status: "suspended", reason: "test" }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("operator can suspend and reactivate with an audited reason", async () => {
    const r = await createTenantWithOwner(db, signupInput({ hotelName: "Suspend Me" }));
    const actor = { userId: r.userId, isPlatformAdmin: true };
    const list = await listTenantsForPlatform(db, actor);
    const row = list.find((t) => t.id === r.tenantId)!;
    expect(row.propertyCount).toBe(1);
    expect(row.ownerEmail).toContain("@example.test");

    await setTenantStatus(db, actor, { tenantId: r.tenantId, status: "suspended", reason: "Non-payment" });
    expect((await loadTenantContext(db, r.userId, r.tenantId))?.tenantStatus).toBe("suspended");
    await setTenantStatus(db, actor, { tenantId: r.tenantId, status: "active", reason: "Paid" });

    const actions = (await db.select().from(auditLogs).where(eq(auditLogs.tenantId, r.tenantId))).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["tenant.suspended", "tenant.reactivated"]));
  });
});
