import { describe, expect, it } from "vitest";
import { parseServerEnv } from "@/lib/env";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { sanitizeMetadata } from "@/modules/audit/service";
import { slugify } from "@/modules/tenants/onboarding";
import { redact } from "@/lib/observability/logger";
import { isValidTimezone, TIMEZONES } from "@/lib/timezones";

describe("env validation", () => {
  const valid = {
    DATABASE_URL: "postgresql://u:p@host/db",
    AUTH_SECRET: "x".repeat(32),
    APP_URL: "http://localhost:3000",
  };

  it("accepts a valid configuration", () => {
    expect(parseServerEnv(valid).DATABASE_URL).toBe(valid.DATABASE_URL);
  });

  it("names the missing variable without printing secret values", () => {
    const run = () => parseServerEnv({ ...valid, AUTH_SECRET: "short-secret-value" });
    expect(run).toThrow(/AUTH_SECRET/);
    expect(run).not.toThrow(/short-secret-value/);
  });
});

describe("password hashing", () => {
  it("verifies the right password and rejects others", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h).not.toContain("correct horse battery");
    expect(await verifyPassword(h, "correct horse battery")).toBe(true);
    expect(await verifyPassword(h, "wrong password!")).toBe(false);
    expect(await verifyPassword("not-a-hash", "x")).toBe(false);
  });
});

describe("secret hygiene", () => {
  it("audit metadata drops secret-looking keys", () => {
    expect(sanitizeMetadata({ name: "A", password: "p", wifiPassword: "w", apiToken: "t" })).toEqual({ name: "A" });
  });

  it("logger redacts secret-looking keys recursively", () => {
    expect(redact({ a: 1, nested: { secret: "s", ok: true }, authorization: "Bearer x" })).toEqual({
      a: 1,
      nested: { secret: "[redacted]", ok: true },
      authorization: "[redacted]",
    });
  });
});

describe("timezones", () => {
  it("accepts modern IANA names that ICU lists under legacy aliases", () => {
    expect(isValidTimezone("Asia/Kolkata")).toBe(true);
    expect(isValidTimezone("UTC")).toBe(true);
    expect(TIMEZONES).toContain("Asia/Kolkata");
    expect(TIMEZONES).not.toContain("Asia/Calcutta");
  });

  it("rejects unknown zones", () => {
    expect(isValidTimezone("Mars/Olympus")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
  });
});

describe("slugify", () => {
  it("produces url-safe slugs", () => {
    expect(slugify("Hôtel Grand Palace & Spa!")).toBe("hotel-grand-palace-spa");
    expect(slugify("!!!")).toBe("hotel");
  });
});
