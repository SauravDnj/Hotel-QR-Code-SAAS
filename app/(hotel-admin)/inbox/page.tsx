import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { PermissionDenied } from "@/components/permission-denied";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState } from "@/components/ui/card";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { propertyScope } from "@/lib/permissions/authorize";
import { cn } from "@/lib/utils";
import { allowedActions, inboxMarker, listInbox } from "@/modules/requests/staff";
import { ACTIONS, REASON_REQUIRED, STAFF_STATUS_LABEL } from "@/modules/requests/state";
import { transitionAction } from "./actions";
import { LiveInbox } from "./live-inbox";
import { ageLabel, minutesSince, PRIORITY_TONE, STATUS_TONE } from "./ui";

export const metadata: Metadata = { title: "Requests" };

const VIEWS = [
  { key: "active", label: "Open" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
  { key: "all", label: "All" },
] as const;

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ view?: string; mine?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireTenantContext();
  const scope = propertyScope(ctx, "request.view");
  if (scope !== "all" && scope.length === 0) return <PermissionDenied />;
  const db = getDb();
  const view = VIEWS.some((v) => v.key === sp.view) ? (sp.view as (typeof VIEWS)[number]["key"]) : "active";
  const mine = sp.mine === "1";
  const [items, marker] = await Promise.all([listInbox(db, ctx, { view, mine: mine ? "1" : undefined }), inboxMarker(db, ctx)]);
  const href = (v: string, m: boolean) => `/inbox?view=${v}${m ? "&mine=1" : ""}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Requests</h1>
          <p className="text-sm text-muted-foreground">Guest requests for your departments. Newest and most urgent first.</p>
        </div>
        <LiveInbox initial={marker} />
      </div>

      <nav aria-label="Request views" className="flex flex-wrap gap-2 text-sm">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={href(v.key, mine)}
            aria-current={v.key === view ? "page" : undefined}
            className={cn(
              "rounded-full border border-border px-3 py-1.5",
              v.key === view ? "bg-primary text-primary-foreground" : "bg-surface hover:bg-surface-muted",
            )}
          >
            {v.label}
            {v.key === "active" && marker.newCount > 0 && <span className="ml-1.5 font-semibold">({marker.newCount} new)</span>}
          </Link>
        ))}
        <Link
          href={href(view, !mine)}
          aria-pressed={mine}
          className={cn("rounded-full border border-border px-3 py-1.5", mine ? "bg-accent text-accent-foreground" : "bg-surface hover:bg-surface-muted")}
        >
          Assigned to me
        </Link>
      </nav>

      {items.length === 0 ? (
        <EmptyState
          title={view === "active" ? "All caught up" : "Nothing here"}
          description={view === "active" ? "New guest requests appear here automatically." : "No requests match this view."}
        />
      ) : (
        <ul className="space-y-3" aria-label="Requests">
          {items.map((r) => {
            const minutes = minutesSince(r.submittedAt);
            const overdue = ["new", "acknowledged", "reopened", "in_progress"].includes(r.status) && minutes > r.targetMinutes;
            const quick = allowedActions(ctx, r).filter((a) => !REASON_REQUIRED.has(a));
            return (
              <li key={r.id}>
                <Card className={cn("flex flex-col gap-3 p-4 sm:flex-row sm:items-center", r.status === "new" && "border-l-4 border-l-accent")}>
                  <Link href={`/inbox/${r.id}`} className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-lg font-semibold">Room {r.roomCode}</span>
                      <span className="font-medium">{r.serviceName}</span>
                      <Badge tone={STATUS_TONE[r.status]}>{STAFF_STATUS_LABEL[r.status]}</Badge>
                      {r.priority !== "normal" && <Badge tone={PRIORITY_TONE[r.priority]}>{r.priority}</Badge>}
                      {overdue && <Badge tone="danger">Overdue</Badge>}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {[r.quantity !== null ? `× ${r.quantity}` : null, r.option, r.departmentName].filter(Boolean).join(" · ")}
                      {" · "}
                      {ageLabel(minutes)}
                      {r.assigneeName && <> · {r.assigneeName}</>}
                    </p>
                    {r.guestNote && <p className="mt-1 line-clamp-2 text-sm">“{r.guestNote}”</p>}
                  </Link>
                  {quick.length > 0 && (
                    <div className="flex shrink-0 gap-2">
                      {quick.map((a) => (
                        <ActionForm key={a} action={transitionAction.bind(null, r.id, a)} aria-label={`${ACTIONS[a].label} room ${r.roomCode}`}>
                          <Button type="submit" size="sm" variant={a === "acknowledge" ? "primary" : "secondary"}>
                            {ACTIONS[a].label}
                          </Button>
                        </ActionForm>
                      ))}
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
