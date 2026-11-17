import Link from "next/link";
import type { reservationCalendar } from "@/modules/reservations/service";
import { cn } from "@/lib/utils";

type Calendar = Awaited<ReturnType<typeof reservationCalendar>>;

const dayLabel = (d: string) => {
  const date = new Date(`${d}T00:00:00Z`);
  return {
    dow: date.toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" }),
    day: date.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }),
  };
};

/** Room × night grid. Bookings link to their detail page; in-house walk-ins show the guest. */
export function ReservationCalendar({ cal, propertyId }: { cal: Calendar; propertyId: string }) {
  const index = new Map(cal.nights.map((n, i) => [n, i]));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-xs" aria-label="Availability calendar">
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-10 w-20 bg-surface px-2 py-2 text-left font-medium">
              Room
            </th>
            {cal.nights.map((n) => {
              const l = dayLabel(n);
              return (
                <th
                  key={n}
                  scope="col"
                  className={cn("px-1 py-2 text-center font-medium", n === cal.today && "bg-accent/15")}
                  aria-current={n === cal.today ? "date" : undefined}
                >
                  <span className="block text-muted-foreground">{l.dow}</span>
                  {l.day}
                </th>
              );
            })}
          </tr>
        </thead>
        {cal.categories.map((c) => (
          <tbody key={c.id} className="border-t-2 border-border">
            <tr className="bg-surface-muted">
              <th scope="row" className="sticky left-0 z-10 bg-surface-muted px-2 py-1.5 text-left font-semibold">
                {c.name}
              </th>
              {c.free.map((f, i) => (
                <td key={i} className={cn("px-1 py-1.5 text-center", f <= 0 ? "font-semibold text-danger" : "text-muted-foreground")}>
                  <span className="sr-only">{cal.nights[i]}: </span>
                  {f <= 0 ? "Full" : `${f} free`}
                </td>
              ))}
            </tr>
            {c.unassigned.some((u) => u > 0) && (
              <tr>
                <th scope="row" className="sticky left-0 z-10 bg-surface px-2 py-1.5 text-left font-normal text-muted-foreground">
                  Unassigned
                </th>
                {c.unassigned.map((u, i) => (
                  <td key={i} className="px-1 py-1.5 text-center">
                    {u > 0 ? <span className="rounded-full bg-warning-surface px-1.5 text-warning">{u}</span> : ""}
                  </td>
                ))}
              </tr>
            )}
            {c.rooms.map((r) => {
              const cells: React.ReactNode[] = [];
              let i = 0;
              const segs = [...r.segments].sort((a, b) => a.from.localeCompare(b.from));
              for (const s of segs) {
                const start = index.get(s.from) ?? 0;
                const end = s.to >= cal.to ? cal.nights.length : (index.get(s.to) ?? cal.nights.length);
                if (start < i || end <= start) continue; // overlapping overstay: keep the first
                for (; i < start; i++) cells.push(<td key={`e${i}`} className="border-l border-border/50" />);
                const label = s.code ? `${s.label} · ${s.code}` : `${s.label} · in house`;
                cells.push(
                  <td key={s.id} colSpan={end - start} className="border-l border-border/50 p-0.5">
                    {s.kind === "booking" ? (
                      <Link
                        href={`/reservations/${s.id}?property=${propertyId}`}
                        className={cn(
                          "block truncate rounded px-1.5 py-1 font-medium",
                          s.status === "checked_in" ? "bg-success-surface text-success" : "bg-primary text-primary-foreground",
                        )}
                        title={label}
                      >
                        {label}
                      </Link>
                    ) : (
                      <span className="block truncate rounded bg-success-surface px-1.5 py-1 font-medium text-success" title={label}>
                        {label}
                      </span>
                    )}
                  </td>,
                );
                i = end;
              }
              for (; i < cal.nights.length; i++) cells.push(<td key={`e${i}`} className="border-l border-border/50" />);
              return (
                <tr key={r.id} className="border-t border-border/50">
                  <th scope="row" className="sticky left-0 z-10 bg-surface px-2 py-1.5 text-left font-semibold">
                    {r.roomCode}
                  </th>
                  {cells}
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
    </div>
  );
}
