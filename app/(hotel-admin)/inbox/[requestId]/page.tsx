import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { loadOr404 } from "@/lib/page-errors";
import { canWrite } from "@/lib/permissions/authorize";
import { departmentScope, inDepartmentScope } from "@/lib/permissions/departments";
import { formatDateTime } from "@/lib/utils";
import { getProperty } from "@/modules/properties/service";
import { allowedActions, getRequestForStaff, listAssignableStaff } from "@/modules/requests/staff";
import { ACTIONS, REASON_REQUIRED, STAFF_STATUS_LABEL } from "@/modules/requests/state";
import { assignAction, transitionAction } from "../actions";
import { PRIORITY_TONE, STATUS_TONE } from "../ui";

export const metadata: Metadata = { title: "Request" };

export default async function RequestDetailPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  const ctx = await requireTenantContext();
  const db = getDb();
  const { request: r, history } = await loadOr404(() => getRequestForStaff(db, ctx, requestId));
  const property = await getProperty(db, ctx, r.propertyId).catch(() => null);
  const tz = property?.timezone ?? "UTC";
  const actions = allowedActions(ctx, r);
  const canAssign =
    canWrite(ctx, "request.assign", { propertyId: r.propertyId }) &&
    inDepartmentScope(departmentScope(ctx, "request.assign", r.propertyId), r.departmentKey) &&
    r.status !== "completed" &&
    r.status !== "cancelled";
  const staff = canAssign ? await listAssignableStaff(db, ctx, r.id) : [];

  return (
    <div className="space-y-5">
      <Link href="/inbox" className="text-sm text-primary underline-offset-4 hover:underline">
        ← All requests
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">
          Room {r.roomCode} · {r.serviceName}
        </h1>
        <Badge tone={STATUS_TONE[r.status]}>{STAFF_STATUS_LABEL[r.status]}</Badge>
        {r.priority !== "normal" && <Badge tone={PRIORITY_TONE[r.priority]}>{r.priority}</Badge>}
      </div>

      <Card>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Property</dt>
            <dd>{property?.name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Department</dt>
            <dd>{r.departmentName}</dd>
          </div>
          {r.quantity !== null && (
            <div>
              <dt className="text-muted-foreground">Quantity</dt>
              <dd>{r.quantity}</dd>
            </div>
          )}
          {r.option && (
            <div>
              <dt className="text-muted-foreground">Choice</dt>
              <dd>{r.option}</dd>
            </div>
          )}
          <div>
            <dt className="text-muted-foreground">Submitted</dt>
            <dd>{formatDateTime(r.submittedAt, tz)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Target</dt>
            <dd>{r.targetMinutes} min</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Assigned to</dt>
            <dd>{r.assigneeName ?? "Nobody yet"}</dd>
          </div>
          {r.guestNote && (
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Guest note</dt>
              <dd className="whitespace-pre-line">{r.guestNote}</dd>
            </div>
          )}
          {r.guestMessage && (
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Message shown to guest</dt>
              <dd>{r.guestMessage}</dd>
            </div>
          )}
          {r.cancelReason && (
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Cancel reason (internal)</dt>
              <dd>{r.cancelReason}</dd>
            </div>
          )}
        </dl>
      </Card>

      {actions.length > 0 && (
        <Card className="space-y-4">
          <h2 className="text-sm font-semibold">Update</h2>
          {actions.map((a) => (
            <ActionForm key={a} action={transitionAction.bind(null, r.id, a)} className="flex flex-wrap items-end gap-2" aria-label={ACTIONS[a].label}>
              <Input
                name="note"
                aria-label={`${ACTIONS[a].label}: internal note`}
                placeholder={REASON_REQUIRED.has(a) ? "Reason (required, staff only)" : "Internal note (optional)"}
                required={REASON_REQUIRED.has(a)}
                className="w-64"
              />
              {a !== "cancel" && (
                <Input
                  name="guestMessage"
                  aria-label={`${ACTIONS[a].label}: message to guest`}
                  placeholder="Message to guest (optional)"
                  maxLength={300}
                  className="w-64"
                />
              )}
              <Button type="submit" variant={a === "cancel" ? "danger" : a === "acknowledge" ? "primary" : "secondary"}>
                {ACTIONS[a].label}
              </Button>
            </ActionForm>
          ))}
          <p className="text-xs text-muted-foreground">Internal notes are never shown to the guest; the guest message is.</p>
        </Card>
      )}

      {canAssign && (
        <Card>
          <h2 className="mb-3 text-sm font-semibold">Assign</h2>
          {staff.length === 0 ? (
            <p className="text-sm text-muted-foreground">No staff member covers this department yet.</p>
          ) : (
            <ActionForm action={assignAction.bind(null, r.id)} className="flex flex-wrap items-end gap-2" aria-label="Assign request">
              <Select name="userId" defaultValue={r.assignedUserId ?? ""} aria-label="Staff member" className="w-64">
                <option value="" disabled>
                  Choose…
                </option>
                {staff.map((s) => (
                  <option key={s.userId} value={s.userId}>
                    {s.name}
                  </option>
                ))}
              </Select>
              <Button type="submit" variant="secondary">
                Assign
              </Button>
            </ActionForm>
          )}
        </Card>
      )}

      <Card>
        <h2 className="mb-3 text-sm font-semibold">History</h2>
        <ol className="space-y-2 text-sm">
          {history.map((h) => (
            <li key={h.id} className="flex flex-wrap justify-between gap-2 border-b border-border pb-2 last:border-0">
              <span>
                {h.fromStatus && h.fromStatus !== h.toStatus ? `${STAFF_STATUS_LABEL[h.fromStatus]} → ` : ""}
                {h.fromStatus === h.toStatus ? "" : STAFF_STATUS_LABEL[h.toStatus]}
                {h.note && <span className="text-muted-foreground"> {h.fromStatus === h.toStatus ? "" : "· "}{h.note}</span>}
              </span>
              <span className="text-muted-foreground">
                {h.source === "guest" ? "Guest" : (h.actorName ?? "System")} · {formatDateTime(h.changedAt, tz)}
              </span>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
