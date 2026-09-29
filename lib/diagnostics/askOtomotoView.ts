import type {
  AiAssistantAudience,
  AiAssistantMode,
  AiAssistantPhase,
  AiAssistantThreadStatus,
  AiAssistantTriggerType,
  TechnicianNoteType,
} from "@/lib/database/types";
import type {
  DiagnosticsMessageView,
  DiagnosticsThreadSummary,
  DiagnosticsThreadWorkspace,
} from "@/lib/services/diagnosticsAssistant";
import type { AskOtomotoPublicConfig } from "@/lib/diagnostics/config";
import type { DiagnosticsPhotoSourceRow } from "@/lib/diagnostics/photoSelection";
import type { FloorStage } from "@/lib/technician/floorStage";
import { isRouteUuid, technicianPacketHref } from "@/lib/technician/routeState";
import { TECHNICIAN_NOTE_TYPE_LABELS } from "@/lib/status/labels";

export type AskOtomotoSurface = "office" | "floor";

export type AskOtomotoLockReason = "preview" | "foreign" | "locked" | "role";

export type AskOtomotoCapabilities = {
  canMutate: boolean;
  preview: boolean;
  readOnly: boolean;
  lockReason: AskOtomotoLockReason | null;
  canUseFrontOfficeModes: boolean;
  canPromoteNotes: boolean;
};

export type AskOtomotoJobOption = { jobId: string; label: string };

/** Everything the shared panel needs; server-built and serializable. */
export type AskOtomotoPanelData = {
  route: AskOtomotoRoute;
  threads: AskOtomotoThreadListItem[];
  /** Requested thread id from the URL, validated as a UUID. */
  selectedThreadId: string | null;
  workspace: DiagnosticsThreadWorkspace | null;
  jobs: AskOtomotoJobOption[];
  defaultJobId: string | null;
  photos: DiagnosticsPhotoSourceRow[];
  config: AskOtomotoPublicConfig;
  capabilities: AskOtomotoCapabilities;
  historyUnavailable?: boolean;
};

export type AskOtomotoRoute =
  | { surface: "office"; workOrderId: string }
  | {
      surface: "floor";
      workOrderId: string;
      jobId: string | null;
      stage: FloorStage | null;
    };

export const ASSISTANT_MODE_LABELS: Record<AiAssistantMode, string> = {
  shop: "Technician (/shop)",
  teach: "Teach (/teach)",
  intake: "Intake",
  advisor: "Service Advisor",
  report: "Report (/report)",
};

export const ASSISTANT_MODE_DESCRIPTIONS: Record<AiAssistantMode, string> = {
  shop: "Evidence-first diagnosis for the technician on this bike.",
  teach: "Explains the why behind each test while diagnosing.",
  report:
    "Generated report draft — not a statutory inspection certificate. The official inspection report template is not installed.",
  intake: "Drafts intake questions and a concern summary for front-office staff.",
  advisor: "Drafts customer-facing explanations. Copy only — nothing is sent.",
};

export const ASSISTANT_STATUS_LABELS: Record<AiAssistantThreadStatus, string> = {
  pending: "Pending",
  generating: "Generating",
  ready: "Ready",
  failed: "Failed",
  archived: "Archived",
};

export const ASSISTANT_PHASE_LABELS: Record<AiAssistantPhase, string> = {
  information_needed: "Information needed",
  diagnosis: "Diagnosis",
  repair_planning: "Repair planning",
  repair_in_progress: "Repair in progress",
  verification: "Verification",
  ready_for_technician_verification: "Ready for technician verification",
  closure_report: "Closure report",
};

export const ASSISTANT_TRIGGER_LABELS: Record<AiAssistantTriggerType, string> = {
  inspection_completed: "Automatic arrival-inspection review",
  job_completed: "Automatic job-completion review",
};

const TECHNICAL_MODES: readonly AiAssistantMode[] = ["shop", "teach", "report"];
const FRONT_OFFICE_MODES: readonly AiAssistantMode[] = ["intake", "advisor"];
const PROMOTABLE_MODES: ReadonlySet<AiAssistantMode> = new Set(TECHNICAL_MODES);

export function assistantModeOptions(input: {
  surface: AskOtomotoSurface;
  canUseFrontOfficeModes: boolean;
}): AiAssistantMode[] {
  return input.surface === "office" && input.canUseFrontOfficeModes
    ? [...TECHNICAL_MODES, ...FRONT_OFFICE_MODES]
    : [...TECHNICAL_MODES];
}

export function askOtomotoThreadHref(
  route: AskOtomotoRoute,
  threadId: string | null
): string {
  const safeThreadId = isRouteUuid(threadId) ? threadId : null;
  if (route.surface === "office") {
    const params = new URLSearchParams({ tab: "assistant" });
    if (safeThreadId) params.set("thread", safeThreadId);
    return `/work_orders/${encodeURIComponent(route.workOrderId)}?${params.toString()}`;
  }
  return technicianPacketHref({
    workOrderId: route.workOrderId,
    jobId: route.jobId,
    stage: route.stage,
    section: "assistant",
    assistantThreadId: safeThreadId,
  });
}

export type AskOtomotoThreadListItem = {
  threadId: string;
  jobId: string | null;
  jobLabel: string | null;
  mode: AiAssistantMode;
  audience: AiAssistantAudience;
  status: AiAssistantThreadStatus;
  diagnosticPhase: AiAssistantPhase | null;
  triggerType: AiAssistantTriggerType | null;
  createdAt: string;
  updatedAt: string;
};

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function toAskOtomotoThreadListItems(
  threads: readonly DiagnosticsThreadSummary[],
  options: { surface: AskOtomotoSurface; jobLabels: Readonly<Record<string, string>> }
): AskOtomotoThreadListItem[] {
  return threads
    .filter((thread) => options.surface === "office" || thread.audience === "technical")
    .map((thread) => ({
      threadId: thread.threadId,
      jobId: thread.jobId,
      jobLabel: thread.jobId ? (options.jobLabels[thread.jobId] ?? null) : null,
      mode: thread.mode,
      audience: thread.audience,
      status: thread.status,
      diagnosticPhase: thread.diagnosticPhase,
      triggerType: thread.triggerType,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
    }))
    .sort(
      (a, b) =>
        timestamp(b.updatedAt) - timestamp(a.updatedAt) ||
        timestamp(b.createdAt) - timestamp(a.createdAt)
    );
}

const REQUESTED_INPUT_LABELS = {
  question: "Question",
  measurement: "Measurement",
  technical_data: "Technical data",
  photo: "Photo",
  test_result: "Test result",
} as const;

export type AskOtomotoRequestedInputType = keyof typeof REQUESTED_INPUT_LABELS;

export type AskOtomotoRequestedInput = {
  type: AskOtomotoRequestedInputType;
  label: string;
  prompt: string;
  purpose: string | null;
  toolPlacement: string | null;
  conditions: string | null;
  units: string | null;
};

function optionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** Display-only view of `requested_input`; unknown or `none` types render nothing. */
export function parseRequestedInput(value: unknown): AskOtomotoRequestedInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const type = record.type;
  if (typeof type !== "string" || !Object.hasOwn(REQUESTED_INPUT_LABELS, type)) {
    return null;
  }
  const prompt = optionalText(record.prompt);
  if (!prompt) return null;
  const typed = type as AskOtomotoRequestedInputType;
  return {
    type: typed,
    label: REQUESTED_INPUT_LABELS[typed],
    prompt,
    purpose: optionalText(record.purpose),
    toolPlacement: optionalText(record.tool_placement),
    conditions: optionalText(record.conditions),
    units: optionalText(record.units),
  };
}

const MODES: ReadonlySet<string> = new Set(Object.keys(ASSISTANT_MODE_LABELS));

/** Runtime check of `createAssistantThreadAction` data before navigating. */
export function parseCreatedThread(
  data: unknown,
  workOrderId: string
): { threadId: string; jobId: string | null; mode: AiAssistantMode } | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  if (typeof record.threadId !== "string" || !isRouteUuid(record.threadId)) return null;
  if (record.workOrderId !== workOrderId) return null;
  const jobId = record.jobId ?? null;
  if (jobId !== null && (typeof jobId !== "string" || !isRouteUuid(jobId))) return null;
  if (typeof record.mode !== "string" || !MODES.has(record.mode)) return null;
  return {
    threadId: record.threadId,
    jobId: jobId as string | null,
    mode: record.mode as AiAssistantMode,
  };
}

export const ASSISTANT_NOTE_TEXT_MAX = 8_000;

/** Plain-text starting point for a reviewed note; markdown emphasis is dropped. */
export function assistantDraftPlainText(body: string): string {
  return body.replace(/\*\*/g, "").slice(0, ASSISTANT_NOTE_TEXT_MAX);
}

export function canPromoteAssistantMessage(input: {
  message: Pick<DiagnosticsMessageView, "role" | "generationStatus" | "body">;
  thread: Pick<DiagnosticsThreadSummary, "mode" | "audience" | "status">;
  canPromoteNotes: boolean;
}): boolean {
  return (
    input.canPromoteNotes &&
    input.message.role === "assistant" &&
    input.message.generationStatus === "ready" &&
    Boolean(input.message.body?.trim()) &&
    input.thread.audience === "technical" &&
    PROMOTABLE_MODES.has(input.thread.mode) &&
    input.thread.status !== "archived"
  );
}

/** Mirrors the promotion schema; gating types (QC, road test, proof exception) are excluded. */
export const PROMOTABLE_NOTE_TYPES: ReadonlyArray<{
  value: TechnicianNoteType;
  label: string;
}> = (
  [
    "diagnostic_finding",
    "general",
    "customer_concern_confirmed",
    "customer_concern_not_found",
    "parts_issue",
    "internal_warning",
  ] as const
).map((value) => ({ value, label: TECHNICIAN_NOTE_TYPE_LABELS[value] }));

export const ASSISTANT_POLL = {
  initialMs: 2_500,
  maxMs: 10_000,
  timeoutMs: 180_000,
} as const;

export function nextAssistantPollDelay(attempt: number): number {
  return Math.min(
    Math.round(ASSISTANT_POLL.initialMs * 1.5 ** Math.max(0, attempt)),
    ASSISTANT_POLL.maxMs
  );
}

export function isAssistantThreadWorking(workspace: DiagnosticsThreadWorkspace): boolean {
  const { thread, messages } = workspace;
  if (thread.status === "generating") return true;
  if (thread.status === "pending" && thread.triggerType !== null) return true;
  if (thread.status === "failed" || thread.status === "archived") return false;
  const latest = messages[messages.length - 1];
  return (
    latest?.role === "assistant" &&
    (latest.generationStatus === "pending" || latest.generationStatus === "generating")
  );
}
