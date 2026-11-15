import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-ui border border-border bg-surface p-5 shadow-sm", className)} {...props} />;
}

type Tone = "info" | "success" | "danger" | "warning";
const tones: Record<Tone, string> = {
  info: "border-border bg-surface-muted text-foreground",
  success: "border-success/30 bg-success-surface text-success",
  danger: "border-danger/30 bg-danger-surface text-danger",
  warning: "border-warning/30 bg-warning-surface text-warning",
};

export function Alert({ tone = "info", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("rounded-ui border px-4 py-3 text-sm", tones[tone], className)}
    >
      {children}
    </div>
  );
}

/** Status badge: always carries a text label, never colour alone. */
export function Badge({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="rounded-ui border border-dashed border-border p-8 text-center">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions}
    </div>
  );
}
