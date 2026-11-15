import { Badge } from "@/components/ui/card";
import type { HousekeepingStatus, RoomOperationalStatus } from "@/lib/db/schema/enums";

type Tone = "info" | "success" | "danger" | "warning";

export const OPERATIONAL_LABELS: Record<RoomOperationalStatus, { label: string; tone: Tone }> = {
  active: { label: "In service", tone: "success" },
  out_of_order: { label: "Out of order", tone: "danger" },
  maintenance: { label: "Maintenance", tone: "warning" },
  inactive: { label: "Inactive", tone: "info" },
};

export const HOUSEKEEPING_LABELS: Record<HousekeepingStatus, { label: string; tone: Tone }> = {
  clean: { label: "Clean", tone: "success" },
  inspected: { label: "Inspected", tone: "success" },
  dirty: { label: "Dirty", tone: "warning" },
  in_progress: { label: "Cleaning", tone: "info" },
  blocked: { label: "Blocked", tone: "danger" },
};

export function OperationalBadge({ status }: { status: RoomOperationalStatus }) {
  const s = OPERATIONAL_LABELS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function HousekeepingBadge({ status }: { status: HousekeepingStatus }) {
  const s = HOUSEKEEPING_LABELS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
