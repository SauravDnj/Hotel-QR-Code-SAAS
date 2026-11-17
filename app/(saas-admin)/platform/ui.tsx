import { Badge } from "@/components/ui/card";

export const statusTone = (s: string) =>
  s === "suspended" || s === "cancelled" || s === "disabled" ? "danger" : s === "past_due" || s === "trialing" ? "warning" : "success";

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone(status)}>{status.replace("_", " ")}</Badge>;
}

export function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-ui border border-border bg-surface p-4 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Plain input (no id) so many small forms can share a page without duplicate ids. */
export function ReasonInput({ label = "Reason (required, audited)", className = "" }: { label?: string; className?: string }) {
  return (
    <input
      name="reason"
      required
      minLength={3}
      maxLength={500}
      aria-label={label}
      placeholder={label}
      className={`min-h-9 rounded-ui border border-border bg-surface px-2 text-sm ${className}`}
    />
  );
}

export const th = "px-3 py-2.5 font-medium";
export const td = "px-3 py-2.5 align-top";
