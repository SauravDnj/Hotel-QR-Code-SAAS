import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { AutoRefresh } from "@/components/auto-refresh";
import { PermissionDenied } from "@/components/permission-denied";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { can, canWrite } from "@/lib/permissions/authorize";
import { cn, formatDateTime } from "@/lib/utils";
import { READINESS_LABEL, READINESS_TONE, type Readiness } from "@/modules/housekeeping/readiness";
import { readinessBoard } from "@/modules/housekeeping/service";
import { PropertyPicker, propertiesFor } from "../property-picker";
import { finishCleaningAction, inspectAction, setPolicyAction, startCleaningAction } from "./actions";

export const metadata: Metadata = { title: "Housekeeping" };

const ORDER: Readiness[] = ["needs_cleaning", "cleaning", "awaiting_inspection", "ready", "occupied", "out_of_service"];
const FILTERS: { key: string; label: string; match: (r: Readiness) => boolean }[] = [
  { key: "todo", label: "To do", match: (r) => r === "needs_cleaning" || r === "cleaning" || r === "awaiting_inspection" },
  { key: "all", label: "All rooms", match: () => true },
];

const REASON: Record<string, string> = {
  checkout: "After checkout",
  inspection_failed: "Inspection failed",
  after_cleaning: "After cleaning",
  manual: "Requested",
};

/** Room readiness board + cleaning/inspection actions. Shows no guest identities. */
export default async function HousekeepingPage({ searchParams }: { searchParams: Promise<{ property?: string; show?: string }> }) {
  const { property: requested, show } = await searchParams;
  const ctx = await requireTenantContext();
  const db = getDb();
  const { props, selected } = await propertiesFor(db, ctx, "room.view", requested);
  if (!selected || !can(ctx, "housekeeping.view", { propertyId: selected.id })) return <PermissionDenied />;
  const board = await readinessBoard(db, ctx, selected.id);
  const manage = canWrite(ctx, "housekeeping.manage", { propertyId: selected.id });
  const policy = canWrite(ctx, "property.manage", { propertyId: selected.id });
  const filter = FILTERS.find((f) => f.key === show) ?? FILTERS[0];
  const items = board.items.filter((i) => filter.match(i.readiness)).sort((a, b) => ORDER.indexOf(a.readiness) - ORDER.indexOf(b.readiness));
  const base = `/housekeeping?property=${selected.id}`;

  return (
    <div className="space-y-5">
      <AutoRefresh seconds={20} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Housekeeping</h1>
          <p className="text-sm text-muted-foreground">
            {selected.name} · rooms become ready only after cleaning{board.requireInspection ? " and inspection" : ""}.
          </p>
        </div>
        {policy && (
          <ActionForm action={setPolicyAction.bind(null, selected.id, !board.requireInspection)}>
            <Button type="submit" size="sm" variant="ghost">
              {board.requireInspection ? "Stop requiring inspection" : "Require inspection after cleaning"}
            </Button>
          </ActionForm>
        )}
      </div>
      <PropertyPicker base="/housekeeping" props={props} selectedId={selected.id} />

      <ul className="flex flex-wrap gap-2 text-sm" aria-label="Summary">
        {ORDER.map((r) => (
          <li key={r}>
            <Badge tone={READINESS_TONE[r]}>
              {READINESS_LABEL[r]}: {board.counts[r] ?? 0}
            </Badge>
          </li>
        ))}
      </ul>

      <nav aria-label="Board filter" className="flex gap-2 text-sm">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`${base}&show=${f.key}`}
            aria-current={f === filter ? "page" : undefined}
            className={cn("rounded-full border border-border px-3 py-1.5", f === filter ? "bg-primary text-primary-foreground" : "bg-surface hover:bg-surface-muted")}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      {items.length === 0 ? (
        <EmptyState title={filter.key === "todo" ? "Nothing to clean or inspect" : "No rooms"} description="Rooms appear here after checkout or when marked dirty." />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Rooms">
          {items.map((i) => {
            const task = i.tasks.find((t) => t.status === "in_progress") ?? i.tasks[0];
            return (
              <li key={i.id}>
                <Card className="flex h-full flex-col gap-2 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-lg font-semibold">Room {i.roomCode}</span>
                    <Badge tone={READINESS_TONE[i.readiness]}>{READINESS_LABEL[i.readiness]}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {i.floorName}
                    {i.occupied && i.expectedCheckoutAt && <> · due out {formatDateTime(i.expectedCheckoutAt, selected.timezone)}</>}
                  </p>
                  {task && (
                    <p className="text-sm">
                      {task.taskType === "cleaning" ? "Cleaning" : "Inspection"} · {REASON[task.reason] ?? task.reason}
                      {task.assigneeName && <> · {task.assigneeName}</>}
                      {task.notes && <span className="block text-muted-foreground">“{task.notes}”</span>}
                    </p>
                  )}
                  {manage && (
                    <div className="mt-auto flex flex-wrap gap-2 pt-2">
                      {i.readiness === "needs_cleaning" && (
                        <ActionForm action={startCleaningAction.bind(null, selected.id, i.id)} aria-label={`Start cleaning ${i.roomCode}`}>
                          <Button type="submit" size="sm">
                            Start cleaning
                          </Button>
                        </ActionForm>
                      )}
                      {i.readiness === "cleaning" && (
                        <ActionForm action={finishCleaningAction.bind(null, selected.id, i.id)} className="flex flex-wrap gap-2" aria-label={`Finish cleaning ${i.roomCode}`}>
                          <Input name="note" placeholder="Note (optional)" aria-label="Cleaning note" className="w-40" />
                          <Button type="submit" size="sm">
                            Done
                          </Button>
                        </ActionForm>
                      )}
                      {i.readiness === "awaiting_inspection" && (
                        <>
                          <ActionForm action={inspectAction.bind(null, selected.id, i.id, true)} aria-label={`Pass inspection ${i.roomCode}`}>
                            <Button type="submit" size="sm">
                              Pass
                            </Button>
                          </ActionForm>
                          <ActionForm action={inspectAction.bind(null, selected.id, i.id, false)} className="flex flex-wrap gap-2" aria-label={`Fail inspection ${i.roomCode}`}>
                            <Input name="note" placeholder="What needs redoing?" aria-label="Inspection note" className="w-44" />
                            <Button type="submit" size="sm" variant="secondary">
                              Fail
                            </Button>
                          </ActionForm>
                        </>
                      )}
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
