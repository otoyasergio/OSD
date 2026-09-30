import type {
  AiAssistantAudience,
  AiAssistantGenerationStatus,
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

export type AskOtomotoLockReason =
  "preview" | "foreign" | "locked" | "role" | "job_assignment";

export type AskOtomotoCapabilities = {
  canMutate: boolean;
  preview: boolean;
  readOnly: boolean;
  lockReason: AskOtomotoLockReason | null;
  canUseFrontOfficeModes: boolean;
  canPromoteNotes: boolean;
};

export type AskOtomotoJobOption = { jobId: string; label: string };

/** Panel heading level for its embedding: office tab h2, floor packet h3. */
export type AskOtomotoHeadingLevel = 2 | 3;
export type AskOtomotoSubheadingLevel = 3 | 4;

/** Everything the shared panel needs; server-built and serializable. */
export type AskOtomotoPanelData = {
  route: AskOtomotoRoute;
  threads: AskOtomotoThreadListItem[];
  /** Requested thread id from the URL, validated as a UUID. */
  selectedThreadId: string | null;
  workspace: AskOtomotoWorkspaceView | null;
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
  retryableAt?: string | null;
  automaticRecoveryAt?: string | null;
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
      retryableAt: thread.retryableAt ?? null,
      automaticRecoveryAt: thread.automaticRecoveryAt ?? null,
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

/** Client copy of `requested_input`: known keys only, bounded like the response schema. */
export type AskOtomotoRequestedInputView = {
  type: AskOtomotoRequestedInputType;
  prompt: string;
  purpose: string | null;
  tool_placement: string | null;
  conditions: string | null;
  units: string | null;
};

const REQUESTED_INPUT_MAX = {
  prompt: 750,
  purpose: 500,
  tool_placement: 750,
  conditions: 750,
  units: 120,
} as const;

function optionalText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, max).trim();
  return trimmed ? trimmed : null;
}

export function sanitizeRequestedInput(
  value: unknown
): AskOtomotoRequestedInputView | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const type = record.type;
  if (typeof type !== "string" || !Object.hasOwn(REQUESTED_INPUT_LABELS, type)) {
    return null;
  }
  const prompt = optionalText(record.prompt, REQUESTED_INPUT_MAX.prompt);
  if (!prompt) return null;
  return {
    type: type as AskOtomotoRequestedInputType,
    prompt,
    purpose: optionalText(record.purpose, REQUESTED_INPUT_MAX.purpose),
    tool_placement: optionalText(
      record.tool_placement,
      REQUESTED_INPUT_MAX.tool_placement
    ),
    conditions: optionalText(record.conditions, REQUESTED_INPUT_MAX.conditions),
    units: optionalText(record.units, REQUESTED_INPUT_MAX.units),
  };
}

/** Display-only view of `requested_input`; unknown or `none` types render nothing. */
export function parseRequestedInput(value: unknown): AskOtomotoRequestedInput | null {
  const sanitized = sanitizeRequestedInput(value);
  if (!sanitized) return null;
  return {
    type: sanitized.type,
    label: REQUESTED_INPUT_LABELS[sanitized.type],
    prompt: sanitized.prompt,
    purpose: sanitized.purpose,
    toolPlacement: sanitized.tool_placement,
    conditions: sanitized.conditions,
    units: sanitized.units,
  };
}

export type AskOtomotoThreadView = {
  threadId: string;
  workOrderId: string;
  jobId: string | null;
  mode: AiAssistantMode;
  audience: AiAssistantAudience;
  status: AiAssistantThreadStatus;
  diagnosticPhase: AiAssistantPhase | null;
  triggerType: AiAssistantTriggerType | null;
  createdAt: string;
  updatedAt: string;
  retryableAt?: string | null;
  automaticRecoveryAt?: string | null;
};

export type AskOtomotoMessagePhotoView = {
  photoId: string;
  category: string;
  purpose: string;
  sortOrder: number;
};

export type AskOtomotoMessageView = {
  messageId: string;
  role: DiagnosticsMessageView["role"];
  body: string | null;
  generationStatus: AiAssistantGenerationStatus;
  safeErrorCode?: string | null;
  requestedInput: AskOtomotoRequestedInputView | null;
  phase: AiAssistantPhase | null;
  promotedNoteId: string | null;
  photos: AskOtomotoMessagePhotoView[];
};

/** The only workspace shape serialized to the client; built field by field. */
export type AskOtomotoWorkspaceView = {
  thread: AskOtomotoThreadView;
  messages: AskOtomotoMessageView[];
};

export function toAskOtomotoWorkspaceView(
  workspace: DiagnosticsThreadWorkspace
): AskOtomotoWorkspaceView {
  const { thread, messages } = workspace;
  return {
    thread: {
      threadId: thread.threadId,
      workOrderId: thread.workOrderId,
      jobId: thread.jobId,
      mode: thread.mode,
      audience: thread.audience,
      status: thread.status,
      diagnosticPhase: thread.diagnosticPhase,
      triggerType: thread.triggerType,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      retryableAt: thread.retryableAt ?? null,
      automaticRecoveryAt: thread.automaticRecoveryAt ?? null,
    },
    messages: messages.map((message) => ({
      messageId: message.messageId,
      role: message.role,
      body: message.body,
      generationStatus: message.generationStatus,
      ...(message.generationStatus === "failed" ||
      message.generationStatus === "policy_withheld"
        ? { safeErrorCode: message.safeErrorCode }
        : {}),
      requestedInput: sanitizeRequestedInput(message.requestedInput),
      phase: message.phase,
      promotedNoteId: message.promotedNoteId ?? null,
      photos: message.photos.map((photo) => ({
        photoId: photo.photoId,
        category: photo.category,
        purpose: photo.purpose,
        sortOrder: photo.sortOrder,
      })),
    })),
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

/** Clipboard text: markdown bold/heading markers removed, line structure kept. */
export function assistantCopyText(body: string): string {
  return body
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/\*\*|__/g, "")
        .trimEnd()
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Plain-text starting point for a reviewed note. */
export function assistantDraftPlainText(body: string): string {
  return assistantCopyText(body).slice(0, ASSISTANT_NOTE_TEXT_MAX);
}

export function canPromoteAssistantMessage(input: {
  message: Pick<AskOtomotoMessageView, "role" | "generationStatus" | "body"> & {
    promotedNoteId?: string | null;
  };
  thread: Pick<AskOtomotoThreadView, "mode" | "audience" | "status">;
  canPromoteNotes: boolean;
}): boolean {
  return (
    input.canPromoteNotes &&
    !input.message.promotedNoteId &&
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

export function isAssistantThreadWorking(workspace: AskOtomotoWorkspaceView): boolean {
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
