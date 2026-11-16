import type { Metadata } from "next";
import Link from "next/link";
import { PermissionDenied } from "@/components/permission-denied";
import { buttonVariants } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { MAX_RANGE_DAYS, propertyReport } from "@/modules/reports/service";
import { PropertyPicker, propertiesFor } from "../property-picker";

export const metadata: Metadata = { title: "Reports" };

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const mins = (v: number | null) => (v === null ? "—" : `${v} min`);

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-ui border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ property?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireTenantContext();
  const db = getDb();
  const { props, selected } = await propertiesFor(db, ctx, "report.view", sp.property);
  if (!selected) return <PermissionDenied />;
  let r;
  try {
    r = await propertyReport(db, ctx, selected.id, { from: sp.from, to: sp.to });
  } catch (err) {
    if (err instanceof AppError && err.code === "plan_limit") {
      return (
        <EmptyState
          title="Reports aren't included in your plan"
          description="Upgrade to see occupancy, response times and housekeeping performance."
          action={
            <Link href="/billing" className={buttonVariants()}>
              See plans
            </Link>
          }
        />
      );
    }
    throw err;
  }
  const q = r.requests;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground">
          {selected.name} · {r.range.from} to {r.range.to} ({r.range.days} days, {selected.timezone})
        </p>
      </div>
      <PropertyPicker base="/reports" props={props} selectedId={selected.id} />
      <form className="flex flex-wrap items-end gap-2" aria-label="Date range">
        <input type="hidden" name="property" value={selected.id} />
        <label className="flex flex-col gap-1 text-sm">
          From
          <Input name="from" type="date" defaultValue={r.range.from} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          To
          <Input name="to" type="date" defaultValue={r.range.to} />
        </label>
        <button type="submit" className={buttonVariants({ variant: "secondary" })}>
          Apply
        </button>
        <span className="text-xs text-muted-foreground">Up to {MAX_RANGE_DAYS} days.</span>
      </form>

      <section aria-labelledby="occ-h" className="space-y-3">
        <h2 id="occ-h" className="text-lg font-semibold">
          Occupancy
        </h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Occupancy rate" value={pct(r.occupancy.rate)} hint={`${r.occupancy.roomNights} room-nights`} />
          <Stat label="Sellable rooms" value={r.occupancy.sellable} />
          <Stat label="Check-ins" value={r.occupancy.checkIns} />
          <Stat label="Check-outs" value={r.occupancy.checkOuts} />
        </div>
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm" aria-label="Occupancy by night">
            <thead className="border-b border-border text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Night of</th>
                <th className="px-4 py-2 font-medium">Occupied rooms</th>
                <th className="px-4 py-2 font-medium">Occupancy</th>
              </tr>
            </thead>
            <tbody>
              {r.occupancy.nights.map((n) => (
                <tr key={n.date} className="border-b border-border last:border-0">
                  <td className="px-4 py-1.5">{n.date}</td>
                  <td className="px-4 py-1.5 tabular-nums">{n.occupied ?? "—"}</td>
                  <td className="px-4 py-1.5 tabular-nums">{pct(n.rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>

      <section aria-labelledby="req-h" className="space-y-3">
        <h2 id="req-h" className="text-lg font-semibold">
          Guest requests
        </h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Requests" value={q.total ?? 0} hint={`${q.completed ?? 0} completed · ${q.open ?? 0} open`} />
          <Stat label="Acknowledgement" value={mins(q.ackP50 ?? null)} hint={`median · p90 ${mins(q.ackP90 ?? null)}`} />
          <Stat label="Completion" value={mins(q.doneP50 ?? null)} hint={`median · p90 ${mins(q.doneP90 ?? null)}`} />
          <Stat label="Cancelled" value={pct(q.cancelledRate)} hint={`${q.reopened} reopened · ${q.escalated ?? 0} escalated`} />
        </div>
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm" aria-label="Requests by department">
            <thead className="border-b border-border text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Department</th>
                <th className="px-4 py-2 font-medium">Requests</th>
                <th className="px-4 py-2 font-medium">Completed</th>
                <th className="px-4 py-2 font-medium">Missed target</th>
                <th className="px-4 py-2 font-medium">Avg acknowledgement</th>
                <th className="px-4 py-2 font-medium">Avg completion</th>
              </tr>
            </thead>
            <tbody>
              {q.byDepartment.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-3 text-muted-foreground">
                    No requests in this period.
                  </td>
                </tr>
              )}
              {q.byDepartment.map((d) => (
                <tr key={d.department} className="border-b border-border last:border-0">
                  <td className="px-4 py-1.5 font-medium">{d.department}</td>
                  <td className="px-4 py-1.5 tabular-nums">{d.total}</td>
                  <td className="px-4 py-1.5 tabular-nums">{d.completed}</td>
                  <td className="px-4 py-1.5 tabular-nums">{d.lateAck}</td>
                  <td className="px-4 py-1.5 tabular-nums">{mins(d.ackAvg)}</td>
                  <td className="px-4 py-1.5 tabular-nums">{mins(d.doneAvg)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        {q.byService.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Most requested: {q.byService.map((s) => `${s.service} (${s.total})`).join(", ")}
          </p>
        )}
      </section>

      <section aria-labelledby="hk-h" className="space-y-3">
        <h2 id="hk-h" className="text-lg font-semibold">
          Housekeeping
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Rooms cleaned" value={r.housekeeping.cleanings} hint={`average ${mins(r.housekeeping.cleanAvg)}`} />
          <Stat label="Inspection pass rate" value={pct(r.housekeeping.passRate)} hint={`${r.housekeeping.inspectionsPassed} passed · ${r.housekeeping.inspectionsFailed} failed`} />
        </div>
      </section>

      <section aria-labelledby="staff-h" className="grid gap-4 md:grid-cols-2">
        <h2 id="staff-h" className="sr-only">
          Staff workload
        </h2>
        <Card>
          <h3 className="mb-2 text-sm font-semibold">Requests completed by staff</h3>
          {r.staff.completions.length === 0 ? (
            <p className="text-sm text-muted-foreground">None in this period.</p>
          ) : (
            <ul className="text-sm">
              {r.staff.completions.map((s) => (
                <li key={s.name} className="flex justify-between border-b border-border py-1 last:border-0">
                  {s.name} <span className="tabular-nums">{s.completed}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <h3 className="mb-2 text-sm font-semibold">Rooms cleaned by staff</h3>
          {r.staff.cleanings.length === 0 ? (
            <p className="text-sm text-muted-foreground">None in this period.</p>
          ) : (
            <ul className="text-sm">
              {r.staff.cleanings.map((s) => (
                <li key={s.name} className="flex justify-between border-b border-border py-1 last:border-0">
                  {s.name} <span className="tabular-nums">{s.cleanings}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <details className="rounded-ui border border-border bg-surface p-4 text-sm">
        <summary className="cursor-pointer font-medium">How these numbers are calculated</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          <li>Sellable rooms: rooms that are in service right now (out-of-order rooms are excluded).</li>
          <li>A room is occupied on a night if a guest was checked in at the midnight that ends that date (property time).</li>
          <li>Occupancy rate = occupied room-nights ÷ (sellable rooms × nights so far). Tonight is not counted yet.</li>
          <li>Acknowledgement time = accepted − submitted; completion time = completed − submitted. Each request counts once.</li>
          <li>Missed target = accepted after the service&apos;s target time, or still not accepted past it.</li>
          <li>Requests are counted by the date they were submitted. You only see departments you have access to.</li>
          <li>Cleaning time = finished − started; pass rate = passed inspections ÷ all inspections.</li>
        </ul>
      </details>
    </div>
  );
}
