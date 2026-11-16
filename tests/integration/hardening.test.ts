import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/types";
import { auditLogs, guests, rateLimits, serviceRequests, stays, users } from "@/lib/db/schema";
import { verifyCredentials } from "@/lib/auth/credentials";
import { currentStep, totpAt } from "@/lib/auth/totp";
import {
  beginMfaEnrollment,
  confirmMfaEnrollment,
  createPasswordResetLink,
  disableMfa,
  getResetToken,
  mfaStatus,
  operatorResetMfa,
  resetPassword,
} from "@/modules/account/security";
import { ANONYMISED_NAME, applyRetention } from "@/modules/privacy/retention";
import { createCategory } from "@/modules/rooms/categories";
import { createFloor } from "@/modules/rooms/floors";
import { createRoom } from "@/modules/rooms/rooms";
import { exportTenantData } from "@/modules/tenants/export";
import { addStaff, createTenantFixture, createTestDb, type TenantFixture } from "../helpers/db";

const PW = "correct horse battery";

describe("Phase 8 hardening", () => {
  let db: Db;
  let A: TenantFixture;
  let email: string;
  const operator = () => ({ userId: A.userId, isPlatformAdmin: true });
  const login = (otp?: string, password = PW, at?: Date) => verifyCredentials(db, { email, password, otp }, null, at);

  beforeAll(async () => {
    db = await createTestDb();
    A = await createTenantFixture(db, { hotelName: "Hardening Hotel" });
    email = (await db.select().from(users).where(eq(users.id, A.userId)))[0].email;
  });
  beforeEach(async () => {
    await db.delete(rateLimits);
  });

  it("two-step sign-in: enroll, then password alone is not enough; codes cannot be replayed", async () => {
    const { secret, url } = await beginMfaEnrollment(db, A.userId);
    expect(url).toContain("otpauth://totp/");
    const [stored] = await db.select().from(users).where(eq(users.id, A.userId));
    expect(stored.mfaSecretCiphertext).not.toContain(secret); // encrypted at rest
    await expect(confirmMfaEnrollment(db, A.userId, "000000")).rejects.toThrow(/didn't match/);
    const t0 = new Date();
    await confirmMfaEnrollment(db, A.userId, totpAt(secret, currentStep(t0.getTime())), t0);
    expect((await mfaStatus(db, A.userId)).enabled).toBe(true);
    const [after] = await db.select().from(users).where(eq(users.id, A.userId));
    expect(after.sessionVersion).toBe(stored.sessionVersion + 1); // old sessions end

    expect(await login()).toEqual({ ok: false, reason: "mfa_required" });
    expect(await login("123456")).toMatchObject({ ok: false, reason: "invalid" });
    expect(await login(undefined, "wrong password!!")).toMatchObject({ ok: false, reason: "invalid" }); // no hint
    const later = new Date(t0.getTime() + 60_000);
    const code = totpAt(secret, currentStep(later.getTime()));
    expect(await login(code, PW, later)).toMatchObject({ ok: true });
    expect(await login(code, PW, later)).toMatchObject({ ok: false, reason: "invalid" }); // replay
  });

  it("operators can't switch it off themselves; staff can with password + code", async () => {
    await db.update(users).set({ isPlatformAdmin: true }).where(eq(users.id, A.userId));
    await expect(disableMfa(db, A.userId, { password: PW, code: "000000" })).rejects.toMatchObject({ code: "forbidden" });
    await db.update(users).set({ isPlatformAdmin: false }).where(eq(users.id, A.userId));

    const staff = await addStaff(db, A, "receptionist", null);
    const { secret } = await beginMfaEnrollment(db, staff.userId);
    const t = new Date();
    await confirmMfaEnrollment(db, staff.userId, totpAt(secret, currentStep(t.getTime())), t);
    await db.update(users).set({ passwordHash: (await db.select().from(users).where(eq(users.id, A.userId)))[0].passwordHash }).where(eq(users.id, staff.userId));
    const t2 = new Date(t.getTime() + 60_000);
    await expect(disableMfa(db, staff.userId, { password: "nope", code: totpAt(secret, currentStep(t2.getTime())) }, t2)).rejects.toThrow(/password/);
    await disableMfa(db, staff.userId, { password: PW, code: totpAt(secret, currentStep(t2.getTime())) }, t2);
    expect((await mfaStatus(db, staff.userId)).enabled).toBe(false);
  });

  it("operator recovery: reset MFA (not their own), one-time password link (audited)", async () => {
    const B = await createTenantFixture(db, { hotelName: "Ops Hotel" });
    const op = { userId: B.userId, isPlatformAdmin: true };
    await expect(operatorResetMfa(db, { userId: A.userId, isPlatformAdmin: false }, { email, reason: "lost phone" })).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(operatorResetMfa(db, operator(), { email, reason: "self" })).rejects.toMatchObject({ code: "forbidden" });
    await operatorResetMfa(db, op, { email, reason: "Lost phone, verified by callback" });
    expect((await mfaStatus(db, A.userId)).enabled).toBe(false);
    expect(await login()).toMatchObject({ ok: true });

    const first = await createPasswordResetLink(db, op, { email, reason: "Forgot password, ticket #12" });
    const second = await createPasswordResetLink(db, op, { email, reason: "Second request" });
    expect(await getResetToken(db, first.token)).toBeNull(); // superseded
    expect(await getResetToken(db, second.token)).toMatchObject({ email });
    await expect(resetPassword(db, second.token, "short")).rejects.toThrow();
    await resetPassword(db, second.token, "a brand new password");
    await expect(resetPassword(db, second.token, "another new password")).rejects.toMatchObject({ code: "not_found" });
    expect(await login(undefined, "a brand new password")).toMatchObject({ ok: true });
    expect(await login()).toMatchObject({ ok: false });
    const actions = (await db.select().from(auditLogs)).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["platform.user_mfa_reset", "platform.password_reset_link_created", "user.password_reset"]));
  });

  it("retention anonymises old guests and notes, keeps recent and in-house ones", async () => {
    const f = await createFloor(db, A.ctx, A.propertyId, { name: "F" });
    const c = await createCategory(db, A.ctx, A.propertyId, { name: "C", capacity: 2 });
    const r1 = await createRoom(db, A.ctx, A.propertyId, { roomCode: "1", floorId: f.id, categoryId: c.id });
    const r2 = await createRoom(db, A.ctx, A.propertyId, { roomCode: "2", floorId: f.id, categoryId: c.id });
    const now = new Date("2027-12-01T00:00:00Z");
    const mk = async (name: string, roomId: string, out: Date | null) => {
      const [g] = await db.insert(guests).values({ tenantId: A.tenantId, name, phone: "+91 90000 11111" }).returning();
      await db.insert(stays).values({
        tenantId: A.tenantId,
        propertyId: A.propertyId,
        roomId,
        guestId: g.id,
        status: out ? "checked_out" : "checked_in",
        checkInAt: new Date("2027-01-01T00:00:00Z"),
        expectedCheckoutAt: new Date("2027-01-05T00:00:00Z"),
        checkedOutAt: out,
      });
      return g.id;
    };
    const old = await mk("Old Guest", r1.id, new Date("2027-01-05T00:00:00Z"));
    const recent = await mk("Recent Guest", r1.id, new Date("2027-11-20T00:00:00Z"));
    const inHouse = await mk("In House", r2.id, null);
    await db.insert(rateLimits).values({ key: "old-key", windowStart: new Date("2027-11-01T00:00:00Z"), count: 1 });

    const res = await applyRetention(db, now);
    const byId = async (id: string) => (await db.select().from(guests).where(eq(guests.id, id)))[0];
    expect(await byId(old)).toMatchObject({ name: ANONYMISED_NAME, phone: null, email: null });
    expect(await byId(recent)).toMatchObject({ name: "Recent Guest" });
    expect(await byId(inHouse)).toMatchObject({ name: "In House" });
    expect(res.rateLimitRowsDeleted).toBeGreaterThanOrEqual(1);
    expect((await applyRetention(db, now)).guestsAnonymised).toBe(0); // idempotent
    void serviceRequests;
  });

  it("export: owners only, own tenant only, never secrets, audited", async () => {
    await beginMfaEnrollment(db, A.userId);
    const data = await exportTenantData(db, A.ctx);
    const json = JSON.stringify(data);
    expect(data.tenant.id).toBe(A.tenantId);
    expect(data.rooms.length).toBeGreaterThan(0);
    for (const forbiddenKey of ["passwordHash", "tokenHash", "Ciphertext", "mfaSecret", "idempotencyKey"]) {
      expect(json).not.toContain(forbiddenKey);
    }
    const other = await createTenantFixture(db, { hotelName: "Not Mine" });
    expect(json).not.toContain(other.tenantId);
    const manager = await addStaff(db, A, "manager", null);
    await expect(exportTenantData(db, manager)).rejects.toMatchObject({ code: "forbidden" });
    expect((await db.select().from(auditLogs).where(eq(auditLogs.action, "tenant.data_exported"))).length).toBe(1);
  });
});
