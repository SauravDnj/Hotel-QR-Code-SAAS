import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/types";
import { auditLogs, requestFeedback } from "@/lib/db/schema";
import { csvCell, toCsv } from "@/lib/csv";
import type { TenantContext } from "@/lib/permissions/authorize";
import { applyRetention } from "@/modules/privacy/retention";
import { getRoomQr } from "@/modules/qr/service";
import { exportReportCsv } from "@/modules/reports/export";
import { propertyReport } from "@/modules/reports/service";
import { feedbackForRequest, submitGuestFeedback } from "@/modules/requests/feedback";
import { getGuestRequestStatus, submitGuestRequest } from "@/modules/requests/guest";
import { transitionRequest } from "@/modules/requests/staff";
import { createCategory } from "@/modules/rooms/categories";
import { createFloor } from "@/modules/rooms/floors";
import { createRoom } from "@/modules/rooms/rooms";
import { createDefaultServices, listServices } from "@/modules/services/catalog";
import { addStaff, createTenantFixture, createTestDb, type TenantFixture } from "../helpers/db";

/** Parses our CSV (no embedded newlines in these tests) into rows of cells. */
function parse(csv: string): string[][] {
  expect(csv.charCodeAt(0)).toBe(0xfeff); // Excel UTF-8 marker
  return csv
    .slice(1)
    .trimEnd()
    .split("\r\n")
    .map((line) => {
      const out: string[] = [];
      let cur = "";
      let q = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (q) {
          if (ch === '"' && line[i + 1] === '"') {
            cur += '"';
            i++;
          } else if (ch === '"') q = false;
          else cur += ch;
        } else if (ch === '"') q = true;
        else if (ch === ",") {
          out.push(cur);
          cur = "";
        }
        else cur += ch;
      }
      out.push(cur);
      return out;
    });
}

describe("guest feedback and report downloads", () => {
  let db: Db;
  let A: TenantFixture;
  let B: TenantFixture;
  let roomService: TenantContext;
  let housekeeper: TenantContext;
  let qr: string;
  let water: { id: string };

  const newRequest = async (note?: string) => {
    const res = await submitGuestRequest(db, qr, { serviceId: water.id, idempotencyKey: crypto.randomUUID(), quantity: "2", note }, { ip: null });
    if (res.kind !== "ok") throw new Error(res.kind);
    return res;
  };
  const complete = async (id: string) => {
    await transitionRequest(db, roomService, id, "acknowledge");
    await transitionRequest(db, roomService, id, "start");
    await transitionRequest(db, roomService, id, "complete");
  };

  beforeAll(async () => {
    db = await createTestDb();
    A = await createTenantFixture(db, { hotelName: "Feedback Hotel" });
    B = await createTenantFixture(db, { hotelName: "Other Hotel" });
    roomService = await addStaff(db, A, "room_service", null);
    housekeeper = await addStaff(db, A, "housekeeping", null);
    const floor = await createFloor(db, A.ctx, A.propertyId, { name: "F1" });
    const cat = await createCategory(db, A.ctx, A.propertyId, { name: "Std", capacity: 2 });
    const room = await createRoom(db, A.ctx, A.propertyId, { roomCode: "101", floorId: floor.id, categoryId: cat.id });
    await createDefaultServices(db, A.ctx, A.propertyId);
    water = (await listServices(db, A.ctx, A.propertyId)).items.find((i) => i.key === "water")!;
    qr = (await getRoomQr(db, A.ctx, A.propertyId, room.id)).active!.url.split("/r/")[1]!;
  });

  it("lets the guest rate a completed request once, with a 1–5 rating", async () => {
    const { statusToken, requestId } = await newRequest();
    expect(await submitGuestFeedback(db, statusToken, { rating: "5" }, { ip: null })).toEqual({ kind: "not_completed" });
    await complete(requestId);

    expect((await submitGuestFeedback(db, statusToken, { rating: "0" }, { ip: null })).kind).toBe("invalid");
    expect((await submitGuestFeedback(db, statusToken, { rating: "6" }, { ip: null })).kind).toBe("invalid");
    expect((await submitGuestFeedback(db, statusToken, { rating: "4", comment: "x".repeat(501) }, { ip: null })).kind).toBe("invalid");
    expect(await submitGuestFeedback(db, "not-a-token", { rating: "4" }, { ip: null })).toEqual({ kind: "unavailable" });

    expect(await submitGuestFeedback(db, statusToken, { rating: "4", comment: "  Quick, thanks!  " }, { ip: null })).toEqual({ kind: "ok" });
    expect(await submitGuestFeedback(db, statusToken, { rating: "1" }, { ip: null })).toEqual({ kind: "already_rated" });
    expect(await feedbackForRequest(db, A.tenantId, requestId)).toMatchObject({ rating: 4, comment: "Quick, thanks!" });

    // The guest sees their own rating on the status page.
    const status = await getGuestRequestStatus(db, statusToken, { ip: null });
    if (status.kind !== "ok") throw new Error(status.kind);
    expect(status.request.feedback).toEqual({ rating: 4, comment: "Quick, thanks!" });
    // Another hotel's staff cannot read it.
    expect(await feedbackForRequest(db, B.tenantId, requestId)).toBeNull();
  });

  it("summarises ratings in Reports, within the reader's department scope", async () => {
    const low = await newRequest();
    await complete(low.requestId);
    await submitGuestFeedback(db, low.statusToken, { rating: "2", comment: "Took too long" }, { ip: null });

    const r = await propertyReport(db, A.ctx, A.propertyId, {});
    expect(r.feedback.count).toBe(2);
    expect(r.feedback.average).toBe(3);
    expect(r.feedback.distribution).toEqual([0, 1, 0, 1, 0]);
    expect(r.feedback.low.map((f) => f.comment)).toEqual(["Took too long"]);
    // Housekeeping can't see Room Service requests, so no ratings either.
    expect((await propertyReport(db, housekeeper, A.propertyId, {}).catch(() => null))?.feedback.count ?? 0).toBe(0);
  });

  it("exports requests, occupancy and revenue as Excel-friendly CSV, audited", async () => {
    await newRequest("=HYPERLINK(\"http://evil\")"); // guest-typed notes are never exported
    const req = parse((await exportReportCsv(db, A.ctx, { type: "requests", propertyId: A.propertyId })).csv);
    expect(req[0]).toContain("Guest rating");
    expect(req[0]).not.toContain("Guest note");
    expect(req.length - 1).toBe(3);
    const rated = req.slice(1).find((row) => row[req[0].indexOf("Guest rating")] === "4")!;
    expect(rated[req[0].indexOf("Service")]).toBe("Drinking water");
    expect(rated[req[0].indexOf("Status")]).toBe("Completed");
    expect(rated[req[0].indexOf("Guest comment")]).toBe("Quick, thanks!");
    expect(req.flat().some((c) => c.includes("HYPERLINK"))).toBe(false);

    const occ = parse((await exportReportCsv(db, A.ctx, { type: "occupancy", propertyId: A.propertyId })).csv);
    expect(occ[0]).toEqual(["Night of", "Occupied rooms", "Sellable rooms", "Occupancy %"]);
    expect(occ.length - 1).toBe(7); // default range: last 7 days

    const rev = parse((await exportReportCsv(db, A.ctx, { type: "revenue", propertyId: A.propertyId })).csv);
    expect(rev[0][0]).toBe("Date");
    expect(rev.at(-1)![0]).toBe("Total");

    const audits = await db.select().from(auditLogs).where(eq(auditLogs.action, "report.exported"));
    expect(audits.map((a) => (a.metadata as { type: string }).type).sort()).toEqual(["occupancy", "requests", "revenue"]);
  });

  it("enforces permission, tenant and type checks on downloads", async () => {
    await expect(exportReportCsv(db, housekeeper, { type: "requests", propertyId: A.propertyId })).rejects.toMatchObject({ code: "forbidden" });
    await expect(exportReportCsv(db, B.ctx, { type: "requests", propertyId: A.propertyId })).rejects.toMatchObject({ code: "not_found" });
    await expect(exportReportCsv(db, A.ctx, { type: "guests", propertyId: A.propertyId })).rejects.toThrow();
  });

  it("neutralises spreadsheet formulas and quotes special characters", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+91 98765")).toBe("'+91 98765");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell(-5)).toBe("-5"); // real numbers stay numbers
    expect(csvCell('He said "hi", ok')).toBe('"He said ""hi"", ok"');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell(null)).toBe("");
    expect(toCsv(["a"], [["₹"]])).toBe("﻿a\r\n₹\r\n");
  });

  it("clears feedback comments after the retention period but keeps the stars", async () => {
    const later = new Date(Date.now() + 200 * 86400_000);
    const res = await applyRetention(db, later);
    expect(res.feedbackCommentsCleared).toBe(2);
    const rows = await db.select().from(requestFeedback).where(eq(requestFeedback.tenantId, A.tenantId));
    expect(rows.every((r) => r.comment === null)).toBe(true);
    expect(rows.map((r) => r.rating).sort()).toEqual([2, 4]);
  });
});
