import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  generateQrToken,
  guestPortalUrl,
  hashQrToken,
  isWellFormedQrToken,
} from "@/lib/crypto/secrets";
import { portalSettingsSchema } from "@/modules/guest-portal/settings";

describe("QR tokens", () => {
  it("are 256-bit, URL-safe, unique and contain no ids", () => {
    const tokens = new Set(Array.from({ length: 1000 }, generateQrToken));
    expect(tokens.size).toBe(1000);
    for (const t of tokens) {
      expect(isWellFormedQrToken(t)).toBe(true);
      expect(Buffer.from(t, "base64url")).toHaveLength(32);
    }
  });

  it("hash deterministically with the pepper, and differently per token", () => {
    const t = generateQrToken();
    expect(hashQrToken(t)).toBe(hashQrToken(t));
    expect(hashQrToken(t)).not.toBe(hashQrToken(generateQrToken()));
    expect(hashQrToken(t)).not.toContain(t);
  });

  it("rejects malformed tokens before any lookup", () => {
    for (const bad of ["", "abc", "1", "../../etc/passwd", "a".repeat(44), `${"a".repeat(42)}=`, 42, null, undefined]) {
      expect(isWellFormedQrToken(bad)).toBe(false);
    }
  });

  it("builds URLs on the guest portal domain", () => {
    expect(guestPortalUrl("x".repeat(43))).toBe(`https://guest.test/r/${"x".repeat(43)}`);
  });
});

describe("secret encryption", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const a = encryptSecret("wifi-pass-123");
    const b = encryptSecret("wifi-pass-123");
    expect(a).not.toBe(b);
    expect(a).not.toContain("wifi-pass-123");
    expect(decryptSecret(a)).toBe("wifi-pass-123");
  });

  it("detects tampering", () => {
    const parts = encryptSecret("secret").split(".");
    const ct = Buffer.from(parts[3], "base64url");
    ct[0] ^= 1;
    parts[3] = ct.toString("base64url");
    expect(() => decryptSecret(parts.join("."))).toThrow();
    expect(() => decryptSecret("v2.a.b.c")).toThrow();
  });
});

describe("portal settings validation", () => {
  it("accepts a typical configuration", () => {
    const v = portalSettingsSchema.parse({
      enabled: "on",
      accentColor: "#1E3A5F",
      logoUrl: "https://cdn.example.com/logo.png",
      wifiSsid: "Hotel-Guest",
      wifiPassword: "secret-pass",
      receptionPhone: "+91 98765 43210",
      checkOutTime: "11:00",
      infoSections: [{ title: "Breakfast", body: "7–10am" }, { title: "", body: "" }],
    });
    expect(v.enabled).toBe(true);
    expect(v.showRoomLabel).toBe(false);
    expect(v.accentColor).toBe("#1e3a5f");
    expect(v.infoSections).toEqual([{ title: "Breakfast", body: "7–10am" }]);
  });

  it("rejects unsafe or invalid values", () => {
    const bad = [
      { accentColor: "red;background:url(x)" },
      { logoUrl: "javascript:alert(1)" },
      { logoUrl: "http://insecure.example.com/x.png" },
      { coverImageUrl: 'https://x.com/a"onerror="x' },
      { checkInTime: "25:00" },
      { wifiSsid: "x".repeat(33) },
      { wifiPassword: "x".repeat(64) },
      { receptionPhone: "call me" },
    ];
    for (const b of bad) expect(() => portalSettingsSchema.parse(b), JSON.stringify(b)).toThrow();
  });
});
