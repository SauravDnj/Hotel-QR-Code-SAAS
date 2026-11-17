import type { Metadata } from "next";
import Link from "next/link";
import { PermissionDenied } from "@/components/permission-denied";
import { buttonVariants } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import { propertyScope } from "@/lib/permissions/authorize";
import { portfolioReport } from "@/modules/reports/service";

export const metadata: Metadata = { title: "All properties" };

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const mins = (v: number | null) => (v === null ? "—" : `${v} min`);

/** Multi-property analytics (Phase 9): the same metrics side by side for every property. */
export default async function PortfolioPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireTenantContext();
  const scope = propertyScope(ctx, "report.view");
  if (scope !== "all" && scope.length === 0) return <PermissionDenied />;
  let p;
  try {
    p = await portfolioReport(getDb(), ctx, { from: sp.from, to: sp.to });
  } catch (err) {
    if (err instanceof AppError && err.code === "plan_limit") {
      return (
        <EmptyState
          title="Reports aren't included in your plan"
          description="Upgrade to compare occupancy, service and revenue across properties."
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
  const first = p.rows[0];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/reports" className="text-sm text-primary underline underline-offset-4">
          ← Reports
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">All properties</h1>
        <p className="text-sm text-muted-foreground">
          {p.totals.properties} propert{p.totals.properties === 1 ? "y" : "ies"} · {first ? `${first.range.from} to ${first.range.to}` : ""} · each
          in its own timezone. Definitions are the same as on the property report.
        </p>
      </div>
      <form className="flex flex-wrap items-end gap-2" aria-label="Date range">
        <label className="flex flex-col gap-1 text-sm">
          From
          <Input name="from" type="date" defaultValue={first?.range.from} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          To
          <Input name="to" type="date" defaultValue={first?.range.to} />
        </label>
        <button type="submit" className={buttonVariants({ variant: "secondary" })}>
          Apply
        </button>
      </form>

      {p.rows.length === 0 ? (
        <EmptyState title="No properties to compare" description="Reports appear for properties you can view." />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[900px] text-left text-sm" aria-label="Property comparison">
            <thead className="border-b border-border text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Property</th>
                <th className="px-3 py-2 text-right font-medium">Occupancy</th>
                <th className="px-3 py-2 text-right font-medium">Room-nights</th>
                <th className="px-3 py-2 text-right font-medium">Requests</th>
                <th className="px-3 py-2 text-right font-medium">Accept p50</th>
                <th className="px-3 py-2 text-right font-medium">Done p50</th>
                <th className="px-3 py-2 text-right font-medium">On time</th>
                <th className="px-3 py-2 text-right font-medium">Escalated</th>
                <th className="px-3 py-2 text-right font-medium">Inspections passed</th>
                <th className="px-3 py-2 text-right font-medium">Orders</th>
                <th className="px-3 py-2 text-right font-medium">Bookings</th>
              </tr>
            </thead>
            <tbody>
              {p.rows.map((r) => (
                <tr key={r.propertyId} className="border-b border-border last:border-0">
                  <th scope="row" className="px-3 py-2 font-medium">
                    <Link href={`/reports?property=${r.propertyId}&from=${r.range.from}&to=${r.range.to}`} className="text-primary underline underline-offset-4">
                      {r.name}
                    </Link>
                    <span className="block text-xs font-normal text-muted-foreground">{r.sellable} sellable rooms</span>
                  </th>
                  <td className="px-3 py-2 text-right tabular-nums">{pct(r.occupancy)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.roomNights}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.requests}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{mins(r.ackP50)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{mins(r.doneP50)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{pct(r.onTimeRate)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.escalated}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{pct(r.inspectionPassRate)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(r.ordersMinor, r.currency)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.bookings}
                    <span className="block text-xs text-muted-foreground">{r.noShows} no-shows</span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-border font-semibold">
              <tr>
                <th scope="row" className="px-3 py-2">
                  Total
                </th>
                <td className="px-3 py-2 text-right tabular-nums">
                  {p.totals.sellable && p.totals.nights ? pct(p.totals.roomNights / (p.totals.sellable * p.totals.nights)) : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{p.totals.roomNights}</td>
                <td className="px-3 py-2 text-right tabular-nums">{p.totals.requests}</td>
                <td colSpan={3} />
                <td className="px-3 py-2 text-right tabular-nums">{p.totals.escalated}</td>
                <td />
                <td className="px-3 py-2 text-right tabular-nums">{p.totals.currency ? formatMoney(p.totals.ordersMinor, p.totals.currency) : "mixed currencies"}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </Card>
      )}
      <p className="text-xs text-muted-foreground">
        Total occupancy is approximate when today is inside the range (tonight isn&apos;t counted yet).
      </p>
    </div>
  );
}
