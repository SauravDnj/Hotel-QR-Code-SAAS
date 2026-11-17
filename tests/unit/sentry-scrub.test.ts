import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/nextjs";
import { scrubBreadcrumb, scrubEvent, scrubUrl } from "@/lib/observability/sentry";

describe("Sentry privacy scrubbing", () => {
  it("masks guest, receipt, invite and reset tokens and drops query strings", () => {
    expect(scrubUrl("https://h.example/r/Y4piQPOn0hJSirbyG0ng4Umc0WEB/request/abc")).toBe("https://h.example/r/[token]/request/abc");
    expect(scrubUrl("/s/abcDEF123_-xyz")).toBe("/s/[token]");
    expect(scrubUrl("/invite/tok?x=1")).toBe("/invite/[token]");
    expect(scrubUrl("/reset-password/abc#top")).toBe("/reset-password/[token]#top");
    expect(scrubUrl("/reports?from=2026-01-01&property=1")).toBe("/reports");
    expect(scrubUrl("/rooms/101")).toBe("/rooms/101"); // not a secret path
  });

  it("removes cookies, headers, bodies and user from events", () => {
    const event = {
      type: undefined,
      request: { method: "POST", url: "https://h.example/s/secretToken?a=1", cookies: { session: "x" }, headers: { cookie: "s=1", authorization: "Bearer x", "user-agent": "UA" }, data: { password: "p" } },
      user: { email: "someone@example.com", ip_address: "1.2.3.4" },
      extra: { token: "abc", room: "101" },
      message: "failed at /r/abcdefghijk",
      exception: { values: [{ type: "Error", value: "fetch /invite/zzz failed" }] },
    } as unknown as ErrorEvent;
    const out = scrubEvent(event);
    expect(out.request).toEqual({ method: "POST", url: "https://h.example/s/[token]", headers: { "user-agent": "UA" } });
    expect(out.user).toBeUndefined();
    expect(out.extra).toEqual({ token: "[redacted]", room: "101" });
    expect(out.message).toBe("failed at /r/[token]");
    expect(out.exception?.values?.[0].value).toBe("fetch /invite/[token] failed");
  });

  it("scrubs navigation and fetch breadcrumbs", () => {
    expect(scrubBreadcrumb({ category: "navigation", data: { from: "/s/abc", to: "/r/def?x=1" } }).data).toEqual({ from: "/s/[token]", to: "/r/[token]" });
    expect(scrubBreadcrumb({ category: "fetch", data: { url: "/api/x?token=1", authorization: "y" } }).data).toEqual({ url: "/api/x", authorization: "[redacted]" });
  });
});
