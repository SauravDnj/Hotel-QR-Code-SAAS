import { describe, expect, it } from "vitest";
import { clientIp } from "@/lib/auth/ip";
import { base32Decode, base32Encode, currentStep, generateTotpSecret, otpauthUrl, totpAt, verifyTotp } from "@/lib/auth/totp";

// RFC 6238 Appendix B (SHA-1), secret = ASCII "12345678901234567890"; 6-digit codes are the
// last 6 digits of the published 8-digit values.
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("TOTP", () => {
  it("matches the RFC 6238 test vectors", () => {
    expect(RFC_SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(totpAt(RFC_SECRET, Math.floor(59 / 30))).toBe("287082");
    expect(totpAt(RFC_SECRET, Math.floor(1111111109 / 30))).toBe("081804");
    expect(totpAt(RFC_SECRET, Math.floor(1234567890 / 30))).toBe("005924");
    expect(totpAt(RFC_SECRET, Math.floor(2000000000 / 30))).toBe("279037");
  });

  it("round-trips base32 and makes 160-bit secrets", () => {
    const s = generateTotpSecret();
    expect(base32Decode(s)).toHaveLength(20);
    expect(base32Encode(base32Decode(s))).toBe(s);
  });

  it("accepts ±1 step of drift, rejects older codes and replays", () => {
    const now = 1_800_000_000_000;
    const step = currentStep(now);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step), { now })).toBe(step);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step - 1), { now })).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step - 2), { now })).toBeNull();
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step), { now, lastStep: step })).toBeNull();
    expect(verifyTotp(RFC_SECRET, "12345", { now })).toBeNull();
    expect(verifyTotp(RFC_SECRET, "abcdef", { now })).toBeNull();
  });

  it("builds a standard otpauth URL", () => {
    expect(otpauthUrl("ABC", "a@b.c")).toBe("otpauth://totp/Hotel%20SaaS%3Aa%40b.c?secret=ABC&issuer=Hotel%20SaaS&algorithm=SHA1&digits=6&period=30");
  });
});

describe("client IP", () => {
  it("prefers the platform-set x-real-ip over a spoofable x-forwarded-for", () => {
    expect(clientIp(new Headers({ "x-real-ip": "1.1.1.1", "x-forwarded-for": "6.6.6.6, 1.1.1.1" }))).toBe("1.1.1.1");
    expect(clientIp(new Headers({ "x-forwarded-for": "2.2.2.2, 3.3.3.3" }))).toBe("2.2.2.2");
    expect(clientIp(new Headers())).toBeNull();
  });
});
