import {
  AlarmClock,
  Bell,
  CarTaxiFront,
  ConciergeBell,
  Flower2,
  GlassWater,
  MessageSquare,
  Shield,
  Shirt,
  Sparkles,
  Utensils,
  Wrench,
  type LucideIcon,
} from "lucide-react";

/** Keep in sync with SERVICE_ICONS in modules/services/catalog.ts. */
const ICONS: Record<string, LucideIcon> = {
  bell: Bell,
  "glass-water": GlassWater,
  sparkles: Sparkles,
  "concierge-bell": ConciergeBell,
  wrench: Wrench,
  "message-square": MessageSquare,
  utensils: Utensils,
  shirt: Shirt,
  shield: Shield,
  flower: Flower2,
  car: CarTaxiFront,
  "alarm-clock": AlarmClock,
};

export function ServiceIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? Bell;
  return <Icon className={className} aria-hidden />;
}
