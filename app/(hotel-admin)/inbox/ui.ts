import type { RequestPriority, RequestStatus } from "@/lib/db/schema/enums";

type Tone = "info" | "success" | "warning" | "danger";

export const STATUS_TONE: Record<RequestStatus, Tone> = {
  new: "warning",
  acknowledged: "info",
  in_progress: "info",
  completed: "success",
  cancelled: "danger",
  reopened: "warning",
};

export const PRIORITY_TONE: Record<RequestPriority, Tone> = {
  low: "info",
  normal: "info",
  high: "warning",
  urgent: "danger",
};

export function ageLabel(minutes: number): string {
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const h = Math.floor(minutes / 60);
  if (h < 24) return `${h} h ${minutes % 60} min ago`;
  return `${Math.floor(h / 24)} d ago`;
}

/** Server-rendered age; the inbox re-renders on every poll/realtime refresh. */
export function minutesSince(date: Date): number {
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000));
}
