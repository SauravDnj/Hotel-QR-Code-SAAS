import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signTokenRequest } from "@/lib/realtime/ably";
import { departmentChannel } from "@/lib/realtime/channels";
import type { TenantContext } from "@/lib/permissions/authorize";
import { SYSTEM_ROLES } from "@/lib/permissions/catalog";
import { departmentScope, inDepartmentScope } from "@/lib/permissions/departments";
import { backoffSeconds } from "@/modules/realtime/outbox";
import { ACTIONS, availableActions, canTransition, GUEST_STATUS, STAFF_ACTIONS } from "@/modules/requests/state";
import { isAvailableAt, localTime } from "@/modules/services/catalog";
import type { RequestStatus } from "@/lib/db/schema/enums";

describe("request state machine", () => {
  const allowed: [RequestStatus, RequestStatus][] = [
    ["new", "acknowledged"],
    ["new", "cancelled"],
    ["acknowledged", "in_progress"],
    ["acknowledged", "cancelled"],
    ["in_progress", "completed"],
    ["in_progress", "cancelled"],
    ["completed", "reopened"],
    ["reopened", "acknowledged"],
    ["reopened", "in_progress"],
  ];
  const statuses: RequestStatus[] = ["new", "acknowledged", "in_progress", "completed", "cancelled", "reopened"];

  it("allows exactly the documented transitions", () => {
    for (const from of statuses) {
      for (const a of STAFF_ACTIONS) {
        const expected = allowed.some(([f, t]) => f === from && t === ACTIONS[a].to);
        expect(canTransition(from, a), `${from} -${a}-> ${ACTIONS[a].to}`).toBe(expected);
      }
    }
  });

  it("closed states have no way forward except reopening a completed request", () => {
    expect(availableActions("cancelled")).toEqual([]);
    expect(availableActions("completed")).toEqual(["reopen"]);
    expect(availableActions("new")).toEqual(["acknowledge", "cancel"]);
  });

  it("maps every internal state to guest wording without internal terms", () => {
    expect(GUEST_STATUS.new.label).toBe("Request sent");
    expect(GUEST_STATUS.acknowledged.label).toBe("Hotel team notified");
    expect(GUEST_STATUS.in_progress.label).toBe("Being handled");
    expect(GUEST_STATUS.reopened.label).toBe("Being reviewed");
    for (const s of statuses) expect(GUEST_STATUS[s].label).not.toMatch(/acknowledged|in_progress|reopened/);
  });

  it("each action needs the documented permission, and roles hold what they should", () => {
    expect(ACTIONS.acknowledge.permission).toBe("request.accept");
    expect(ACTIONS.reopen.permission).toBe("request.reopen");
    expect(SYSTEM_ROLES.housekeeping.permissions).not.toContain("request.cancel");
    expect(SYSTEM_ROLES.housekeeping.permissions).not.toContain("request.reopen");
    expect(SYSTEM_ROLES.receptionist.permissions).toContain("request.cancel");
    expect(SYSTEM_ROLES.manager.permissions).toContain("request.reopen");
  });
});

describe("department scope from roles and assignments", () => {
  const ctx = (grants: { roleKey: string; propertyId: string | null; departmentId?: string | null }[]): TenantContext => ({
    userId: "u",
    membershipId: "m",
    tenantId: "t",
    tenantName: "T",
    tenantStatus: "active",
    grants: grants.map((g) => ({ ...g, permissions: new Set(["request.view" as const]) })),
  });
  const keys = (...k: string[]) => ({ keys: new Set(k), ids: new Set<string>() });

  it("maps department roles to their department; managers and custom roles to all", () => {
    expect(departmentScope(ctx([{ roleKey: "housekeeping", propertyId: null }]), "request.view", "p1")).toEqual(keys("housekeeping"));
    expect(departmentScope(ctx([{ roleKey: "manager", propertyId: null }]), "request.view", "p1")).toBe("all");
    expect(departmentScope(ctx([{ roleKey: "custom_role", propertyId: null }]), "request.view", "p1")).toBe("all");
  });

  it("an explicit department on the assignment narrows even a manager", () => {
    const s = departmentScope(ctx([{ roleKey: "manager", propertyId: "p1", departmentId: "d9" }]), "request.view", "p1");
    expect(s).toEqual({ keys: new Set(), ids: new Set(["d9"]) });
    expect(inDepartmentScope(s, { id: "d9", key: "spa" })).toBe(true);
    expect(inDepartmentScope(s, { id: "d1", key: "reception" })).toBe(false);
  });

  it("respects property scoping of each grant", () => {
    const c = ctx([
      { roleKey: "housekeeping", propertyId: "p1" },
      { roleKey: "maintenance", propertyId: "p2" },
    ]);
    expect(departmentScope(c, "request.view", "p1")).toEqual(keys("housekeeping"));
    expect(departmentScope(c, "request.view", "p2")).toEqual(keys("maintenance"));
    expect(departmentScope(c, "request.view", "p3")).toEqual(keys());
  });
});

describe("service hours", () => {
  it("formats local time in the property's timezone", () => {
    expect(localTime(new Date("2026-11-16T00:00:00Z"), "Asia/Kolkata")).toBe("05:30");
    expect(localTime(new Date("2026-11-16T00:00:00Z"), "America/New_York")).toBe("19:00");
  });

  it("handles same-day and overnight windows", () => {
    const at = (iso: string) => new Date(iso);
    const day = { availableFrom: "07:00", availableTo: "10:00" };
    expect(isAvailableAt(day, "UTC", at("2026-11-16T07:00:00Z"))).toBe(true);
    expect(isAvailableAt(day, "UTC", at("2026-11-16T10:00:00Z"))).toBe(false);
    const night = { availableFrom: "22:00", availableTo: "06:00" };
    expect(isAvailableAt(night, "UTC", at("2026-11-16T23:00:00Z"))).toBe(true);
    expect(isAvailableAt(night, "UTC", at("2026-11-16T05:59:00Z"))).toBe(true);
    expect(isAvailableAt(night, "UTC", at("2026-11-16T12:00:00Z"))).toBe(false);
    expect(isAvailableAt({ availableFrom: null, availableTo: null }, "UTC")).toBe(true);
  });
});

describe("realtime", () => {
  it("signs Ably token requests over the documented field order", () => {
    const req = signTokenRequest("app.key", "secret", {
      ttl: 3600000,
      capability: { "hotel:t:p:d": ["subscribe"] },
      clientId: "user-1",
      timestamp: 1700000000000,
      nonce: "abc",
    });
    const text = `app.key\n3600000\n{"hotel:t:p:d":["subscribe"]}\nuser-1\n1700000000000\nabc\n`;
    expect(req.mac).toBe(createHmac("sha256", "secret").update(text).digest("base64"));
    expect(JSON.parse(req.capability)).toEqual({ "hotel:t:p:d": ["subscribe"] });
  });

  it("builds per-department channel names and backs off exponentially", () => {
    expect(departmentChannel("t1", "p1", "d1")).toBe("hotel:t1:p1:d1");
    expect([1, 2, 3, 4].map(backoffSeconds)).toEqual([10, 20, 40, 80]);
    expect(backoffSeconds(30)).toBe(3600);
  });
});
