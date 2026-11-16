import type { RequestStatus } from "@/lib/db/schema/enums";
import type { PermissionKey } from "@/lib/permissions/catalog";

/**
 * Request lifecycle from 04-workflows/REQUEST_STATE_MACHINE.md. Pure data so it can be
 * unit-tested and shared by the service layer and the UI (which only hides buttons).
 */

export type StaffAction = "acknowledge" | "start" | "complete" | "cancel" | "reopen";

export const ACTIONS: Record<StaffAction, { to: RequestStatus; from: RequestStatus[]; permission: PermissionKey; label: string }> = {
  acknowledge: { to: "acknowledged", from: ["new", "reopened"], permission: "request.accept", label: "Accept" },
  start: { to: "in_progress", from: ["acknowledged", "reopened"], permission: "request.update", label: "Start" },
  complete: { to: "completed", from: ["in_progress"], permission: "request.complete", label: "Complete" },
  cancel: { to: "cancelled", from: ["new", "acknowledged", "in_progress"], permission: "request.cancel", label: "Cancel" },
  reopen: { to: "reopened", from: ["completed"], permission: "request.reopen", label: "Reopen" },
};

export const STAFF_ACTIONS = Object.keys(ACTIONS) as StaffAction[];

/** Cancel and reopen must say why (state machine "Reason recorded"). */
export const REASON_REQUIRED: ReadonlySet<StaffAction> = new Set(["cancel", "reopen"]);

export const ACTIVE_STATUSES: RequestStatus[] = ["new", "acknowledged", "in_progress", "reopened"];

export function canTransition(from: RequestStatus, action: StaffAction): boolean {
  return ACTIONS[action].from.includes(from);
}

export function availableActions(from: RequestStatus): StaffAction[] {
  return STAFF_ACTIONS.filter((a) => canTransition(from, a));
}

/** Simpler guest-facing wording; never exposes internal states or notes. */
export const GUEST_STATUS: Record<RequestStatus, { label: string; step: number }> = {
  new: { label: "Request sent", step: 1 },
  acknowledged: { label: "Hotel team notified", step: 2 },
  in_progress: { label: "Being handled", step: 3 },
  completed: { label: "Completed", step: 4 },
  cancelled: { label: "Cancelled – please contact reception", step: 0 },
  reopened: { label: "Being reviewed", step: 2 },
};

export const STAFF_STATUS_LABEL: Record<RequestStatus, string> = {
  new: "New",
  acknowledged: "Accepted",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  reopened: "Reopened",
};
