import { describe, expect, it } from "vitest";
import { localDate, zonedToUtc } from "@/lib/timezones";
import { roomReadiness } from "@/modules/housekeeping/readiness";

describe("room readiness keeps the three dimensions separate", () => {
  const base = { operationalStatus: "active" as const, housekeepingStatus: "inspected" as const, occupied: false, pendingInspection: false };

  it("table", () => {
    expect(roomReadiness(base)).toBe("ready");
    expect(roomReadiness({ ...base, occupied: true })).toBe("occupied");
    expect(roomReadiness({ ...base, operationalStatus: "out_of_order" })).toBe("out_of_service");
    expect(roomReadiness({ ...base, operationalStatus: "maintenance", occupied: true })).toBe("out_of_service");
    expect(roomReadiness({ ...base, housekeepingStatus: "blocked" })).toBe("out_of_service");
    expect(roomReadiness({ ...base, housekeepingStatus: "dirty" })).toBe("needs_cleaning");
    expect(roomReadiness({ ...base, housekeepingStatus: "in_progress" })).toBe("cleaning");
    expect(roomReadiness({ ...base, housekeepingStatus: "clean", pendingInspection: true })).toBe("awaiting_inspection");
    expect(roomReadiness({ ...base, housekeepingStatus: "clean" })).toBe("ready");
  });

  it("a dirty room is never ready, whatever else is true", () => {
    for (const occupied of [true, false]) {
      for (const pendingInspection of [true, false]) {
        expect(roomReadiness({ ...base, housekeepingStatus: "dirty", occupied, pendingInspection })).not.toBe("ready");
      }
    }
  });
});

describe("property-local times", () => {
  it("converts wall-clock times to UTC, including DST", () => {
    expect(zonedToUtc("2026-11-20", "11:00", "Asia/Kolkata").toISOString()).toBe("2026-11-20T05:30:00.000Z");
    expect(zonedToUtc("2026-01-15", "11:00", "America/New_York").toISOString()).toBe("2026-01-15T16:00:00.000Z"); // EST
    expect(zonedToUtc("2026-07-15", "11:00", "America/New_York").toISOString()).toBe("2026-07-15T15:00:00.000Z"); // EDT
    expect(zonedToUtc("2026-07-15", "11:00", "UTC").toISOString()).toBe("2026-07-15T11:00:00.000Z");
  });

  it("gives the local calendar date", () => {
    expect(localDate(new Date("2026-11-16T20:00:00Z"), "Asia/Kolkata")).toBe("2026-11-17");
    expect(localDate(new Date("2026-11-16T20:00:00Z"), "America/New_York")).toBe("2026-11-16");
  });
});
