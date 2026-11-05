import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlarmClock,
  AlertTriangle,
  Camera,
  ClipboardCheck,
  ClipboardList,
  FileSignature,
  Hourglass,
  Image,
  KeyRound,
  LayoutDashboard,
  MessageSquare,
  Package,
  Receipt,
  Search,
  Shield,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  StickyNote,
  UserRound,
  Warehouse,
  Wrench,
} from "lucide-react";
import type { WorkOrderTabId } from "@/lib/workOrders/tabs";
import type { AdvisorQueueKind } from "@/lib/accountability/stageContract";

export type IconTone =
  "teal" | "warning" | "waiting" | "success" | "danger" | "orange" | "muted";

const COLUMN_ICONS: Record<string, LucideIcon> = {
  intake: ClipboardList,
  inspection: Search,
  approval: Hourglass,
  parts: Package,
  ready: Wrench,
  in_progress: Wrench,
  qc: ShieldCheck,
  safety: Shield,
  pickup: KeyRound,
  storage: Warehouse,
  on_hold: Hourglass,
  insurance: Shield,
  gallery_intake: ClipboardList,
  gallery_in_bay: Wrench,
  gallery_qc: ShieldCheck,
  gallery_safety: Shield,
  gallery_ready: KeyRound,
  gallery_storage: Warehouse,
  complete: ClipboardCheck,
};

const PIPELINE_ICONS: Record<string, LucideIcon> = {
  intake: ClipboardList,
  inspection: Search,
  approval: Hourglass,
  parts: Package,
  work: Wrench,
  qc: ShieldCheck,
  safety: Shield,
  pickup: KeyRound,
  storage: Warehouse,
};

const DASHBOARD_ICONS: Record<string, LucideIcon> = {
  open: ClipboardList,
  waiting_approval: Hourglass,
  waiting_parts: Package,
  ready_for_technician: Wrench,
  in_progress: Wrench,
  quality_check: ShieldCheck,
  safety_check: Shield,
  ready_for_pickup: KeyRound,
  overdue: AlarmClock,
  incomplete_inspections: ClipboardCheck,
  unassigned_jobs: UserRound,
};

const TAB_ICONS: Record<WorkOrderTabId, LucideIcon> = {
  overview: LayoutDashboard,
  estimate: Receipt,
  inspection: ClipboardCheck,
  parts: Package,
  photos: Image,
  notes: StickyNote,
  assistant: Sparkles,
  timeline: Activity,
  "service-info": Wrench,
  contract: FileSignature,
  messages: MessageSquare,
  diagnostics: Stethoscope,
};

const FLAG_ICONS: Record<string, LucideIcon> = {
  "Missing VIN": AlertTriangle,
  "No intake photos": Camera,
  "Contract unsigned": FileSignature,
  "Incomplete inspection": ClipboardCheck,
  "Needs approval": Hourglass,
  "Waiting for parts": Package,
  "Safety-critical": AlertTriangle,
  Overdue: AlertTriangle,
  "On hold": Hourglass,
  "Admin flag": AlertTriangle,
};

const ADVISOR_ICONS: Record<AdvisorQueueKind, LucideIcon> = {
  unanswered_message: MessageSquare,
  pending_approval: Hourglass,
  overdue_parts: Package,
  missed_promise: AlarmClock,
  customer_update: UserRound,
};

export function columnIcon(columnId: string): LucideIcon {
  return COLUMN_ICONS[columnId] ?? ClipboardList;
}

export function pipelineIcon(stageId: string): LucideIcon {
  return PIPELINE_ICONS[stageId] ?? ClipboardList;
}

export function dashboardIcon(key: string): LucideIcon {
  return DASHBOARD_ICONS[key] ?? ClipboardList;
}

export function tabIcon(id: WorkOrderTabId): LucideIcon {
  return TAB_ICONS[id];
}

export function flagIcon(flag: string): LucideIcon | null {
  return FLAG_ICONS[flag] ?? null;
}

export function advisorIcon(kind: AdvisorQueueKind): LucideIcon {
  return ADVISOR_ICONS[kind];
}

export function IconWell({
  icon: Icon,
  tone = "teal",
}: {
  icon: LucideIcon;
  tone?: IconTone;
}) {
  const toneClass = tone === "teal" ? "" : ` icon-well--${tone}`;
  return (
    <span className={`icon-well${toneClass}`}>
      <Icon aria-hidden strokeWidth={2.25} />
    </span>
  );
}
