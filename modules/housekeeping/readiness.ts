import type { HousekeepingStatus, RoomOperationalStatus } from "@/lib/db/schema/enums";

/**
 * Room readiness combines three INDEPENDENT dimensions (PRD §5, FR-09):
 * operational status, housekeeping status and occupancy (derived from an active stay).
 * Checkout never makes a room ready: it sets housekeeping to `dirty` with a cleaning task;
 * only finishing that cleaning and, when the property requires it, passing the inspection
 * task created at that moment make it ready again. A clean room with no pending inspection
 * (e.g. a brand-new room) is ready.
 */
export type Readiness =
  | "out_of_service"
  | "occupied"
  | "needs_cleaning"
  | "cleaning"
  | "awaiting_inspection"
  | "ready";

export function roomReadiness(r: {
  operationalStatus: RoomOperationalStatus;
  housekeepingStatus: HousekeepingStatus;
  occupied: boolean;
  /** An inspection task is open for this room. */
  pendingInspection: boolean;
}): Readiness {
  if (r.operationalStatus !== "active" || r.housekeepingStatus === "blocked") return "out_of_service";
  if (r.occupied) return "occupied";
  switch (r.housekeepingStatus) {
    case "dirty":
      return "needs_cleaning";
    case "in_progress":
      return "cleaning";
    case "clean":
      return r.pendingInspection ? "awaiting_inspection" : "ready";
    case "inspected":
      return "ready";
  }
}

export const READINESS_LABEL: Record<Readiness, string> = {
  out_of_service: "Out of service",
  occupied: "Occupied",
  needs_cleaning: "Needs cleaning",
  cleaning: "Cleaning",
  awaiting_inspection: "Awaiting inspection",
  ready: "Ready",
};

export const READINESS_TONE: Record<Readiness, "info" | "success" | "warning" | "danger"> = {
  out_of_service: "danger",
  occupied: "info",
  needs_cleaning: "warning",
  cleaning: "warning",
  awaiting_inspection: "warning",
  ready: "success",
};
