import "server-only";

import { z } from "zod";
import { requireUser as requireSessionUser, type AppUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { createDiagnosticsAdminClient } from "@/lib/database/supabase-admin";
import type {
  AiAssistantAudience,
  AiAssistantGenerationStatus,
  AiAssistantMode,
  AiAssistantPhase,
  AiAssistantThreadStatus,
  AiAssistantTriggerType,
  DbClient,
  UserRole,
} from "@/lib/database/types";
import { canViewClients, canViewPricing, isFloorTech } from "@/lib/permissions";
import {
  canViewerAccessWorkOrder,
  canViewerAccessWorkOrderLocation,
  canViewerReadWorkOrderLocation,
} from "@/lib/workOrders/assignmentVisibility";
import {
  shapeDiagnosticsContext,
  type DiagnosticsContextSource,
} from "@/lib/diagnostics/context";
import {
  redactDiagnosticsText,
  type DiagnosticsRedactTerms,
} from "@/lib/diagnostics/redaction";
import {
  DEFAULT_DIAGNOSTICS_TIMEOUT_MS,
  getDiagnosticsConfig,
  getDiagnosticsTimeoutMs,
} from "@/lib/diagnostics/config";
import {
  prepareDiagnosticsImages,
  type DiagnosticsImagePreparationResult,
  type DiagnosticsPhotoRow,
} from "@/lib/diagnostics/images";
import {
  generateDiagnosticsDraft,
  DIAGNOSTICS_MAX_HISTORY_CHARS,
  DIAGNOSTICS_MAX_HISTORY_MESSAGES,
  DIAGNOSTICS_MAX_MESSAGE_CHARS,
  DIAGNOSTICS_PROVIDER_MAX_RETRIES,
  type DiagnosticsGenerationRequest,
  type DiagnosticsGenerationResult,
  type DiagnosticsHistoryMessage,
} from "@/lib/diagnostics/openai";
import { renderDiagnosticsDraft } from "@/lib/diagnostics/outputPolicy";
import { rateLimit, type RateLimitResult } from "@/lib/security/rateLimit";
import { addAuditLog } from "@/lib/audit/addAuditLog";

export const ASK_OTOMOTO_RATE_LIMIT = 12;
export const ASK_OTOMOTO_RATE_WINDOW_MS = 60_000;
export const ASK_OTOMOTO_MAX_TEXT_CHARS = 8_000;
export const ASK_OTOMOTO_MAX_PHOTOS = 3;
export const ASK_OTOMOTO_STALE_MARGIN_MS = 30_000;
export const ASK_OTOMOTO_PENDING_RECOVERY_GRACE_MS = 30_000;
export const ASK_OTOMOTO_ACCEPTANCE_SCENARIO_COUNT = 18;

const ALLOWED_DIAGNOSTICS_PHOTO_CATEGORIES = new Set([
  "inspection_tires",
  "inspection_brakes",
  "inspection_forks",
  "inspection_item",
  "job_work",
  "job_proof",
]);

const VERIFICATION_NOTE_TYPES = new Set(["road_test", "quality_check"]);

function classifyVerificationNote(note: string): string {
  if (
    /\b(?:failed|failure|unsuccessful|did not pass|symptom (?:recurred|remains))\b/i.test(
      note
    )
  ) {
    return "failed";
  }
  if (
    /\b(?:pending|incomplete|not (?:yet )?(?:verified|passed|complete)|retest required|requires? (?:a )?retest|verification (?:is )?(?:not|still))\b/i.test(
      note
    )
  ) {
    return "pending";
  }
  if (/\b(?:passed|successful|verified|resolved)\b/i.test(note)) {
    return "passed";
  }
  return "recorded";
}

const uuidSchema = z.string().uuid();
const nullableUuidSchema = z.string().uuid().nullable().optional();
const modeSchema = z.enum(["shop", "teach", "intake", "advisor", "report"]);
const triggerSchema = z.enum(["inspection_completion", "job_completion"]);
const photoSelectionSchema = z
  .object({
    photoId: uuidSchema,
    purpose: z.string().trim().min(1).max(500),
  })
  .strict();

export const createDiagnosticsThreadSchema = z
  .object({
    workOrderId: uuidSchema,
    jobId: nullableUuidSchema,
    mode: modeSchema,
  })
  .strict();

export const submitDiagnosticsTurnSchema = z
  .object({
    workOrderId: uuidSchema,
    threadId: uuidSchema,
    jobId: nullableUuidSchema,
    mode: modeSchema,
    text: z.string().trim().min(1).max(ASK_OTOMOTO_MAX_TEXT_CHARS),
    photos: z.array(photoSelectionSchema).max(ASK_OTOMOTO_MAX_PHOTOS).default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = value.photos.map((photo) => photo.photoId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: "custom",
        path: ["photos"],
        message: "DIAGNOSTICS_IMAGE_DUPLICATE",
      });
    }
  });

export const retryDiagnosticsTurnSchema = z
  .object({
    workOrderId: uuidSchema,
    threadId: uuidSchema,
  })
  .strict();

export type DiagnosticsAccessKind = "read" | "write";

export type DiagnosticsWorkOrderScope = {
  workOrderId: string;
  locationId: string;
  locationStatus: string;
  status: string;
  primaryTechnicianId: string | null;
  qualityCheckAssignedTo: string | null;
  jobs: Array<{
    jobId: string;
    assignedTechnicianId: string | null;
  }>;
};

export type DiagnosticsThreadSummary = {
  threadId: string;
  workOrderId: string;
  jobId: string | null;
  locationId: string;
  mode: AiAssistantMode;
  audience: AiAssistantAudience;
  status: AiAssistantThreadStatus;
  diagnosticPhase: AiAssistantPhase | null;
  triggerType: AiAssistantTriggerType | null;
  triggerEntityId?: string | null;
  createdByUserId?: string | null;
  createdAt: string;
  updatedAt: string;
  retryableAt?: string | null;
  automaticRecoveryAt?: string | null;
};

export type DiagnosticsMessagePhotoView = {
  photoId: string;
  category: string;
  notes: string | null;
  purpose: string;
  sortOrder: number;
  createdAt: string;
};

export type DiagnosticsMessageView = {
  messageId: string;
  threadId: string;
  role: "system" | "user" | "assistant" | "tool";
  body: string | null;
  generationStatus: AiAssistantGenerationStatus;
  requestedInput: unknown;
  phase: AiAssistantPhase | null;
  safeErrorCode: string | null;
  parentUserMessageId: string | null;
  requestedProviderModel: string | null;
  providerModel: string | null;
  createdAt: string;
  updatedAt: string;
  photos: DiagnosticsMessagePhotoView[];
  /** Reviewed note already created from this output; set only by public reads. */
  promotedNoteId?: string | null;
};

export type DiagnosticsThreadWorkspace = {
  thread: DiagnosticsThreadSummary;
  messages: DiagnosticsMessageView[];
};

export type DiagnosticsJobScope = {
  jobId: string;
  workOrderId: string;
};

type CreateThreadRecord = {
  workOrderId: string;
  jobId: string | null;
  locationId: string;
  mode: AiAssistantMode;
  audience: AiAssistantAudience;
  createdByUserId: string;
  triggerType?: AiAssistantTriggerType | null;
  triggerEntityId?: string | null;
};

type BeginTurnInput = {
  workOrderId: string;
  threadId: string;
  userId: string;
  text: string;
  photos: Array<{ photoId: string; purpose: string; sortOrder: number }>;
};

type BeginSeedTurnInput = {
  workOrderId: string;
  threadId: string;
  triggerType: AiAssistantTriggerType;
  triggerEntityId: string;
  userId: string;
  text: string;
};

type TurnRecord = {
  userMessageId: string;
  assistantMessageId: string;
  attemptId: string;
};

type GenerationInput = {
  userMessageId: string;
  assistantMessageId: string;
  attemptId: string;
  userMessage: string;
  photos: Array<{ photoId: string; purpose: string }>;
  selectedPhotoMetadata?: DiagnosticsMessagePhotoView[];
  history: DiagnosticsHistoryMessage[];
};

type LoadedGenerationInput = Omit<GenerationInput, "attemptId">;

type LoadedContext = {
  source: DiagnosticsContextSource;
  redactTerms: DiagnosticsRedactTerms;
};

type CompleteGenerationInput = {
  threadId: string;
  assistantMessageId: string;
  attemptId: string;
  body: string;
  response: DiagnosticsGenerationResult;
  contextAsOf: string;
  phase: AiAssistantPhase;
  requestedInput: unknown;
};

export type DiagnosticsTrustedReadView = {
  role: UserRole;
  subjectUserId: string;
};

type LatestSuccessfulModel = {
  requestedModel: string | null;
  resolvedModel: string;
};

export interface DiagnosticsAssistantRepository {
  loadWorkOrderScope(workOrderId: string): Promise<DiagnosticsWorkOrderScope | null>;
  listThreads(workOrderId: string): Promise<DiagnosticsThreadSummary[]>;
  loadThread(
    workOrderId: string,
    threadId: string
  ): Promise<DiagnosticsThreadWorkspace | null>;
  /** Source message id → technician note id, for this work order only. */
  listPromotedNoteIds(
    workOrderId: string,
    messageIds: readonly string[]
  ): Promise<Map<string, string>>;
  createThread(input: CreateThreadRecord): Promise<DiagnosticsThreadSummary>;
  findTriggerThread(
    workOrderId: string,
    triggerType: AiAssistantTriggerType,
    triggerEntityId: string
  ): Promise<DiagnosticsThreadSummary | null>;
  triggerEntityBelongsToWorkOrder(
    workOrderId: string,
    triggerType: AiAssistantTriggerType,
    triggerEntityId: string
  ): Promise<boolean>;
  isActiveUserAtLocation(userId: string, locationId: string): Promise<boolean>;
  loadJob(workOrderId: string, jobId: string): Promise<DiagnosticsJobScope | null>;
  beginTurn(input: BeginTurnInput): Promise<TurnRecord>;
  beginSeedTurn(input: BeginSeedTurnInput): Promise<TurnRecord>;
  loadGenerationInput(
    workOrderId: string,
    threadId: string,
    userMessageId: string,
    assistantMessageId: string
  ): Promise<LoadedGenerationInput>;
  completeGeneration(input: CompleteGenerationInput): Promise<void>;
  failGeneration(input: {
    threadId: string;
    assistantMessageId: string;
    attemptId: string;
    safeErrorCode: string;
  }): Promise<void>;
  claimLatestRetry(
    workOrderId: string,
    threadId: string,
    staleAfterMs: number
  ): Promise<TurnRecord | null>;
  loadContextSource(
    workOrderId: string,
    jobId: string | null,
    includeFrontOffice: boolean
  ): Promise<LoadedContext>;
  loadPhotoRows(workOrderId: string, photoIds: string[]): Promise<DiagnosticsPhotoRow[]>;
  downloadPhoto(storagePath: string, options: { maxBytes: number }): Promise<Uint8Array>;
  loadLatestSuccessfulModel(
    locationId: string,
    excludeMessageId: string
  ): Promise<LatestSuccessfulModel | null>;
  recordModelChangeAudit?(input: {
    actorUserId: string;
    locationId: string;
    messageId: string;
    previousModel: string;
    requestedModel: string;
    resolvedModel: string;
    promptVersion: string;
    acceptanceRerunRequired: true;
    scenarioCount: number;
  }): Promise<void>;
}

export type DiagnosticsAssistantDependencies = {
  repository?: DiagnosticsAssistantRepository;
  requireUser?: () => Promise<AppUser>;
  generateDraft?: (
    request: DiagnosticsGenerationRequest
  ) => Promise<DiagnosticsGenerationResult>;
  prepareImages?: (
    input: {
      workOrderId: string;
      jobId: string | null;
      selections: Array<{ photoId: string; purpose: string }>;
      redactTerms: LoadedContext["redactTerms"];
    },
    repository: DiagnosticsAssistantRepository
  ) => Promise<DiagnosticsImagePreparationResult>;
  consumeRateLimit?: (userId: string) => RateLimitResult;
  now?: () => Date;
  providerTimeoutMs?: number;
  assertConfigured?: () => void;
};

export function deriveDiagnosticsAudience(mode: AiAssistantMode): AiAssistantAudience {
  return mode === "intake" || mode === "advisor" ? "front_office" : "technical";
}

export function assertDiagnosticsAccess(
  user: AppUser,
  workOrder: DiagnosticsWorkOrderScope,
  mode: AiAssistantMode,
  access: DiagnosticsAccessKind
): void {
  if (user.status !== "active" || user.role === "time_clock_kiosk") {
    throw new Error("FORBIDDEN");
  }
  if (workOrder.locationStatus !== "active") {
    throw new Error("FOREIGN_LOCATION");
  }
  const canAccessLocation =
    access === "read"
      ? canViewerReadWorkOrderLocation({
          workOrderLocationId: workOrder.locationId,
          membershipLocationIds: user.location_ids,
        })
      : canViewerAccessWorkOrderLocation({
          role: user.role,
          workOrderLocationId: workOrder.locationId,
          activeLocationId: user.active_location_id,
          membershipLocationIds: user.location_ids,
        });
  if (!canAccessLocation) {
    throw new Error("FOREIGN_LOCATION");
  }
  if (
    !canViewerAccessWorkOrder(
      {
        primary_technician_id: workOrder.primaryTechnicianId,
        quality_check_assigned_to: workOrder.qualityCheckAssignedTo,
        status: workOrder.status,
        jobs: workOrder.jobs.map((job) => ({
          assigned_technician_id: job.assignedTechnicianId,
        })),
      },
      user.role,
      user.user_id
    )
  ) {
    throw new Error("FORBIDDEN");
  }
  if (
    deriveDiagnosticsAudience(mode) === "front_office" &&
    (!canViewClients(user.role) || !canViewPricing(user.role))
  ) {
    throw new Error("FORBIDDEN");
  }
  if (access === "write" && workOrder.locationId !== user.active_location_id) {
    throw new Error("FOREIGN_LOCATION");
  }
  if (
    access === "write" &&
    (workOrder.status === "completed" || workOrder.status === "cancelled")
  ) {
    throw new Error("WORK_ORDER_LOCKED");
  }
}

export function assertDiagnosticsThreadWrite(
  user: AppUser,
  workOrder: DiagnosticsWorkOrderScope,
  thread: DiagnosticsThreadSummary
): void {
  assertDiagnosticsAccess(user, workOrder, thread.mode, "write");
  if (
    thread.workOrderId !== workOrder.workOrderId ||
    thread.locationId !== workOrder.locationId ||
    thread.audience !== deriveDiagnosticsAudience(thread.mode)
  ) {
    throw new Error("ASK_OTOMOTO_THREAD_SCOPE_MISMATCH");
  }
  if (thread.status === "archived") {
    throw new Error("ASK_OTOMOTO_THREAD_ARCHIVED");
  }
  if (thread.jobId) {
    const scopedJob = workOrder.jobs.find((job) => job.jobId === thread.jobId);
    if (!scopedJob) {
      throw new Error("ASK_OTOMOTO_THREAD_SCOPE_MISMATCH");
    }
    const headTechSafetyException =
      user.role === "head_tech" && workOrder.status === "safety_check";
    if (
      isFloorTech(user.role) &&
      scopedJob.assignedTechnicianId !== user.user_id &&
      !headTechSafetyException
    ) {
      throw new Error("FORBIDDEN");
    }
  }
}

function readActorForView(actor: AppUser, view?: DiagnosticsTrustedReadView): AppUser {
  if (!view || actor.role !== "owner") return actor;
  return {
    ...actor,
    role: view.role,
    user_id: view.subjectUserId,
  };
}

function rowToThread(row: Record<string, unknown>): DiagnosticsThreadSummary {
  return {
    threadId: String(row.ai_assistant_thread_id),
    workOrderId: String(row.work_order_id),
    jobId: row.job_id ? String(row.job_id) : null,
    locationId: String(row.location_id),
    mode: row.mode as AiAssistantMode,
    audience: row.audience as AiAssistantAudience,
    status: row.status as AiAssistantThreadStatus,
    diagnosticPhase: (row.diagnostic_phase as AiAssistantPhase | null) ?? null,
    triggerType: (row.trigger_type as AiAssistantTriggerType | null) ?? null,
    triggerEntityId: row.trigger_entity_id ? String(row.trigger_entity_id) : null,
    createdByUserId: row.created_by_user_id ? String(row.created_by_user_id) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

const THREAD_COLUMNS =
  "ai_assistant_thread_id, work_order_id, job_id, location_id, mode, audience, status, diagnostic_phase, trigger_type, trigger_entity_id, created_by_user_id, created_at, updated_at";
const MESSAGE_COLUMNS =
  "ai_assistant_message_id, thread_id, role, body, generation_status, requested_input, phase, safe_error_code, parent_user_message_id, requested_provider_model, provider_model, created_at, updated_at";

function throwQuery(error: { message?: string; code?: string } | null): void {
  if (error) throw error;
}

function unwrapOne<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

const HISTORY_CLIPPED_MARKER = "\n[CLIPPED FROM STORED HISTORY]";

function clipStoredHistoryText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars - HISTORY_CLIPPED_MARKER.length)}${HISTORY_CLIPPED_MARKER}`;
}

function compactAssistantHistory(message: DiagnosticsMessageView): string {
  const body = message.body ?? "";
  const paragraphs = body
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  const safety = paragraphs.find((part) => /^\*\*SAFETY\b/i.test(part));
  const assessmentIndex = paragraphs.findIndex((part) => /^\*\*Assessments:/i.test(part));
  const assessment = assessmentIndex >= 0 ? paragraphs[assessmentIndex] : undefined;
  const answer =
    assessmentIndex >= 0
      ? paragraphs
          .slice(assessmentIndex + 1)
          .find((part) => !/^\*\*/.test(part) && !/^AI draft\b/i.test(part))
      : undefined;
  const nextStep = paragraphs.find((part) => /^\*\*NEXT STEP:/i.test(part));
  const requestedInput =
    message.requestedInput &&
    typeof message.requestedInput === "object" &&
    !Array.isArray(message.requestedInput) &&
    typeof (message.requestedInput as Record<string, unknown>).prompt === "string"
      ? `**REQUESTED INPUT:** ${String(
          (message.requestedInput as Record<string, unknown>).prompt
        ).trim()}`
      : undefined;

  if (!safety || !assessment || (!nextStep && !requestedInput)) {
    return clipStoredHistoryText(body, DIAGNOSTICS_MAX_MESSAGE_CHARS);
  }

  const compact = [
    clipStoredHistoryText(safety, 1_200),
    clipStoredHistoryText(assessment, 3_500),
    answer ? clipStoredHistoryText(answer, 2_000) : null,
    clipStoredHistoryText(nextStep ?? requestedInput!, 1_000),
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n\n");
  return clipStoredHistoryText(compact, DIAGNOSTICS_MAX_MESSAGE_CHARS);
}

function boundedReadyHistory(
  messages: readonly DiagnosticsMessageView[],
  currentUserIndex: number
): DiagnosticsHistoryMessage[] {
  const prior = messages.slice(0, currentUserIndex);
  const users = new Map<
    string,
    { index: number; message: DiagnosticsMessageView & { body: string; role: "user" } }
  >();
  prior.forEach((message, index) => {
    if (
      message.role === "user" &&
      message.generationStatus === "ready" &&
      Boolean(message.body?.trim())
    ) {
      users.set(message.messageId, {
        index,
        message: message as DiagnosticsMessageView & {
          body: string;
          role: "user";
        },
      });
    }
  });

  const turnByUserId = new Map<
    string,
    {
      order: number;
      user: DiagnosticsHistoryMessage;
      assistant: DiagnosticsHistoryMessage;
    }
  >();
  prior.forEach((message, index) => {
    if (
      message.role !== "assistant" ||
      message.generationStatus !== "ready" ||
      !message.body?.trim() ||
      !message.parentUserMessageId
    ) {
      return;
    }
    const parent = users.get(message.parentUserMessageId);
    if (!parent) return;
    turnByUserId.set(parent.message.messageId, {
      order: Math.max(parent.index, index),
      user: {
        role: "user",
        content: clipStoredHistoryText(
          parent.message.body,
          DIAGNOSTICS_MAX_MESSAGE_CHARS
        ),
      },
      assistant: {
        role: "assistant",
        content: compactAssistantHistory(message),
      },
    });
  });

  const selected: Array<{
    order: number;
    user: DiagnosticsHistoryMessage;
    assistant: DiagnosticsHistoryMessage;
  }> = [];
  let aggregateChars = 0;
  const newestFirst = [...turnByUserId.values()].sort((a, b) => b.order - a.order);
  for (const turn of newestFirst) {
    const turnChars = turn.user.content.length + turn.assistant.content.length;
    if (
      selected.length * 2 + 2 > DIAGNOSTICS_MAX_HISTORY_MESSAGES ||
      aggregateChars + turnChars > DIAGNOSTICS_MAX_HISTORY_CHARS
    ) {
      continue;
    }
    selected.push(turn);
    aggregateChars += turnChars;
  }

  return selected
    .sort((a, b) => a.order - b.order)
    .flatMap((turn) => [turn.user, turn.assistant]);
}

export class SupabaseDiagnosticsRepository implements DiagnosticsAssistantRepository {
  private adminClient: DbClient | null = null;

  constructor(
    private readonly session: DbClient,
    private readonly createAdmin: () => DbClient
  ) {}

  private get admin(): DbClient {
    // This getter is intentionally lazy. Public service operations authenticate
    // and authorize the work-order scope before any privileged method reaches it.
    this.adminClient ??= this.createAdmin();
    return this.adminClient;
  }

  async loadWorkOrderScope(
    workOrderId: string
  ): Promise<DiagnosticsWorkOrderScope | null> {
    const { data, error } = await this.session
      .from("work_order")
      .select(
        "work_order_id, location_id, status, primary_technician_id, quality_check_assigned_to, location:location_id(status), jobs:job(job_id, assigned_technician_id)"
      )
      .eq("work_order_id", workOrderId)
      .maybeSingle();
    throwQuery(error);
    if (!data) return null;
    const row = data as Record<string, unknown>;
    const location = unwrapOne(row.location as { status?: string } | null);
    const jobs = (row.jobs ?? []) as Array<Record<string, unknown>>;
    return {
      workOrderId: String(row.work_order_id),
      locationId: String(row.location_id),
      locationStatus: String(location?.status ?? "inactive"),
      status: String(row.status),
      primaryTechnicianId: row.primary_technician_id
        ? String(row.primary_technician_id)
        : null,
      qualityCheckAssignedTo: row.quality_check_assigned_to
        ? String(row.quality_check_assigned_to)
        : null,
      jobs: jobs.map((job) => ({
        jobId: String(job.job_id),
        assignedTechnicianId: job.assigned_technician_id
          ? String(job.assigned_technician_id)
          : null,
      })),
    };
  }

  async listThreads(workOrderId: string): Promise<DiagnosticsThreadSummary[]> {
    const { data, error } = await this.session
      .from("ai_assistant_thread")
      .select(THREAD_COLUMNS)
      .eq("work_order_id", workOrderId)
      .order("updated_at", { ascending: false });
    throwQuery(error);
    return ((data ?? []) as Array<Record<string, unknown>>).map(rowToThread);
  }

  async loadThread(
    workOrderId: string,
    threadId: string
  ): Promise<DiagnosticsThreadWorkspace | null> {
    const { data: thread, error: threadError } = await this.session
      .from("ai_assistant_thread")
      .select(THREAD_COLUMNS)
      .eq("work_order_id", workOrderId)
      .eq("ai_assistant_thread_id", threadId)
      .maybeSingle();
    throwQuery(threadError);
    if (!thread) return null;

    const { data: messages, error: messageError } = await this.session
      .from("ai_assistant_message")
      .select(MESSAGE_COLUMNS)
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });
    throwQuery(messageError);
    const messageRows = (messages ?? []) as Array<Record<string, unknown>>;
    const messageIds = messageRows.map((row) => String(row.ai_assistant_message_id));
    let links: Array<Record<string, unknown>> = [];
    if (messageIds.length > 0) {
      const result = await this.session
        .from("ai_assistant_message_photo")
        .select("message_id, photo_id, sort_order, purpose")
        .in("message_id", messageIds);
      throwQuery(result.error);
      links = (result.data ?? []) as Array<Record<string, unknown>>;
    }
    const photoIds = [...new Set(links.map((link) => String(link.photo_id)))];
    let photos: Array<Record<string, unknown>> = [];
    if (photoIds.length > 0) {
      const result = await this.session
        .from("intake_photo")
        .select("photo_id, category, notes, created_at")
        .eq("work_order_id", workOrderId)
        .in("photo_id", photoIds);
      throwQuery(result.error);
      photos = (result.data ?? []) as Array<Record<string, unknown>>;
    }
    const photoById = new Map(photos.map((photo) => [String(photo.photo_id), photo]));
    return {
      thread: rowToThread(thread as Record<string, unknown>),
      messages: messageRows.map((message) => {
        const messageId = String(message.ai_assistant_message_id);
        return {
          messageId,
          threadId: String(message.thread_id),
          role: message.role as DiagnosticsMessageView["role"],
          body: message.body == null ? null : String(message.body),
          generationStatus: message.generation_status as AiAssistantGenerationStatus,
          requestedInput: message.requested_input ?? null,
          phase: (message.phase as AiAssistantPhase | null) ?? null,
          safeErrorCode: message.safe_error_code ? String(message.safe_error_code) : null,
          parentUserMessageId: message.parent_user_message_id
            ? String(message.parent_user_message_id)
            : null,
          requestedProviderModel: message.requested_provider_model
            ? String(message.requested_provider_model)
            : null,
          providerModel: message.provider_model ? String(message.provider_model) : null,
          createdAt: String(message.created_at),
          updatedAt: String(message.updated_at),
          photos: links
            .filter((link) => String(link.message_id) === messageId)
            .sort((a, b) => Number(a.sort_order) - Number(b.sort_order))
            .flatMap((link) => {
              const photo = photoById.get(String(link.photo_id));
              return photo
                ? [
                    {
                      photoId: String(photo.photo_id),
                      category: String(photo.category),
                      notes: photo.notes == null ? null : String(photo.notes),
                      purpose: String(link.purpose),
                      sortOrder: Number(link.sort_order),
                      createdAt: String(photo.created_at),
                    },
                  ]
                : [];
            }),
        };
      }),
    };
  }

  async listPromotedNoteIds(
    workOrderId: string,
    messageIds: readonly string[]
  ): Promise<Map<string, string>> {
    if (messageIds.length === 0) return new Map();
    const { data, error } = await this.session
      .from("technician_note")
      .select("technician_note_id, source_ai_message_id")
      .eq("work_order_id", workOrderId)
      .in("source_ai_message_id", [...messageIds]);
    throwQuery(error);
    const promoted = new Map<string, string>();
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      if (row.source_ai_message_id && row.technician_note_id) {
        promoted.set(String(row.source_ai_message_id), String(row.technician_note_id));
      }
    }
    return promoted;
  }

  async createThread(input: CreateThreadRecord): Promise<DiagnosticsThreadSummary> {
    const { data, error } = await this.admin
      .from("ai_assistant_thread")
      .insert({
        work_order_id: input.workOrderId,
        job_id: input.jobId,
        location_id: input.locationId,
        mode: input.mode,
        audience: input.audience,
        status: "pending",
        trigger_type: input.triggerType ?? null,
        trigger_entity_id: input.triggerEntityId ?? null,
        created_by_user_id: input.createdByUserId,
      })
      .select(THREAD_COLUMNS)
      .single();
    throwQuery(error);
    return rowToThread(data as Record<string, unknown>);
  }

  async findTriggerThread(
    workOrderId: string,
    triggerType: AiAssistantTriggerType,
    triggerEntityId: string
  ): Promise<DiagnosticsThreadSummary | null> {
    const { data, error } = await this.session
      .from("ai_assistant_thread")
      .select(THREAD_COLUMNS)
      .eq("work_order_id", workOrderId)
      .eq("trigger_type", triggerType)
      .eq("trigger_entity_id", triggerEntityId)
      .maybeSingle();
    throwQuery(error);
    return data ? rowToThread(data as Record<string, unknown>) : null;
  }

  async triggerEntityBelongsToWorkOrder(
    workOrderId: string,
    triggerType: AiAssistantTriggerType,
    triggerEntityId: string
  ): Promise<boolean> {
    const table = triggerType === "inspection_completed" ? "inspection" : "job";
    const idColumn = triggerType === "inspection_completed" ? "inspection_id" : "job_id";
    let query = this.session
      .from(table)
      .select(idColumn)
      .eq("work_order_id", workOrderId)
      .eq(idColumn, triggerEntityId);
    if (triggerType === "job_completed") {
      query = query.eq("status", "completed");
    } else {
      query = query.not("completed_at", "is", null);
    }
    const { data, error } = await query.maybeSingle();
    throwQuery(error);
    return Boolean(data);
  }

  async isActiveUserAtLocation(userId: string, locationId: string): Promise<boolean> {
    const { data: user, error: userError } = await this.session
      .from("app_user")
      .select("user_id")
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    throwQuery(userError);
    if (!user) return false;

    const { data: membership, error: membershipError } = await this.session
      .from("user_location")
      .select("user_id, location_id, location:location_id(status)")
      .eq("user_id", userId)
      .eq("location_id", locationId)
      .maybeSingle();
    throwQuery(membershipError);
    if (!membership) return false;
    const location = unwrapOne(
      (membership as Record<string, unknown>).location as { status?: string } | null
    );
    return location?.status === "active";
  }

  async loadJob(workOrderId: string, jobId: string): Promise<DiagnosticsJobScope | null> {
    const { data, error } = await this.session
      .from("job")
      .select("job_id, work_order_id")
      .eq("work_order_id", workOrderId)
      .eq("job_id", jobId)
      .maybeSingle();
    throwQuery(error);
    return data
      ? { jobId: String(data.job_id), workOrderId: String(data.work_order_id) }
      : null;
  }

  async beginTurn(input: BeginTurnInput): Promise<TurnRecord> {
    const { data, error } = await this.admin.rpc("ask_otomoto_begin_turn", {
      p_thread_id: input.threadId,
      p_work_order_id: input.workOrderId,
      p_user_id: input.userId,
      p_body: input.text,
      p_photos: input.photos.map((photo) => ({
        photo_id: photo.photoId,
        purpose: photo.purpose,
        sort_order: photo.sortOrder,
      })),
    });
    throwQuery(error);
    const row = Array.isArray(data) ? data[0] : data;
    if (
      !row?.user_message_id ||
      !row?.assistant_message_id ||
      !row?.generation_attempt_id
    ) {
      throw new Error("ASK_OTOMOTO_LIFECYCLE_FAILED");
    }
    return {
      userMessageId: String(row.user_message_id),
      assistantMessageId: String(row.assistant_message_id),
      attemptId: String(row.generation_attempt_id),
    };
  }

  async beginSeedTurn(input: BeginSeedTurnInput): Promise<TurnRecord> {
    const { data, error } = await this.admin.rpc("ask_otomoto_begin_seed_turn", {
      p_thread_id: input.threadId,
      p_work_order_id: input.workOrderId,
      p_trigger_type: input.triggerType,
      p_trigger_entity_id: input.triggerEntityId,
      p_user_id: input.userId,
      p_body: input.text,
    });
    throwQuery(error);
    const row = Array.isArray(data) ? data[0] : data;
    if (
      !row?.user_message_id ||
      !row?.assistant_message_id ||
      !row?.generation_attempt_id
    ) {
      throw new Error("ASK_OTOMOTO_LIFECYCLE_FAILED");
    }
    return {
      userMessageId: String(row.user_message_id),
      assistantMessageId: String(row.assistant_message_id),
      attemptId: String(row.generation_attempt_id),
    };
  }

  async loadGenerationInput(
    workOrderId: string,
    threadId: string,
    userMessageId: string,
    assistantMessageId: string
  ): Promise<LoadedGenerationInput> {
    const workspace = await this.loadThread(workOrderId, threadId);
    if (!workspace) throw new Error("ASK_OTOMOTO_THREAD_NOT_FOUND");
    const assistantIndex = workspace.messages.findIndex(
      (message) => message.messageId === assistantMessageId
    );
    const userIndex = workspace.messages.findIndex(
      (message) => message.messageId === userMessageId
    );
    const assistant = workspace.messages[assistantIndex];
    const user = workspace.messages[userIndex];
    if (
      assistantIndex < 0 ||
      userIndex < 0 ||
      !assistant ||
      assistant.role !== "assistant" ||
      assistant.parentUserMessageId !== userMessageId ||
      !user ||
      user.role !== "user" ||
      !user.body
    ) {
      throw new Error("ASK_OTOMOTO_TURN_NOT_FOUND");
    }
    return {
      userMessageId: user.messageId,
      assistantMessageId,
      userMessage: user.body,
      photos: user.photos.map((photo) => ({
        photoId: photo.photoId,
        purpose: photo.purpose,
      })),
      selectedPhotoMetadata: user.photos,
      history: boundedReadyHistory(workspace.messages, userIndex),
    };
  }

  async completeGeneration(input: CompleteGenerationInput): Promise<void> {
    const { error } = await this.admin.rpc("ask_otomoto_complete_turn", {
      p_thread_id: input.threadId,
      p_assistant_message_id: input.assistantMessageId,
      p_generation_attempt_id: input.attemptId,
      p_body: input.body,
      p_requested_input: input.requestedInput,
      p_phase: input.phase,
      p_requested_provider_model: input.response.requestedModel,
      p_resolved_provider_model: input.response.resolvedModel,
      p_provider_response_id: input.response.responseId,
      p_prompt_version: input.response.promptVersion,
      p_input_token_count: input.response.usage.inputTokens,
      p_output_token_count: input.response.usage.outputTokens,
      p_context_as_of: input.contextAsOf,
      p_context_hash: input.response.contextHash,
    });
    throwQuery(error);
  }

  async failGeneration(input: {
    threadId: string;
    assistantMessageId: string;
    attemptId: string;
    safeErrorCode: string;
  }): Promise<void> {
    const { error } = await this.admin.rpc("ask_otomoto_fail_turn", {
      p_thread_id: input.threadId,
      p_assistant_message_id: input.assistantMessageId,
      p_generation_attempt_id: input.attemptId,
      p_safe_error_code: input.safeErrorCode,
    });
    throwQuery(error);
  }

  async claimLatestRetry(
    workOrderId: string,
    threadId: string,
    staleAfterMs: number
  ): Promise<TurnRecord | null> {
    const { data, error } = await this.admin.rpc("ask_otomoto_claim_retry", {
      p_thread_id: threadId,
      p_work_order_id: workOrderId,
      p_stale_after: `${staleAfterMs} milliseconds`,
    });
    throwQuery(error);
    const row = Array.isArray(data) ? data[0] : data;
    if (
      !row?.user_message_id ||
      !row?.assistant_message_id ||
      !row?.generation_attempt_id
    ) {
      return null;
    }
    return {
      userMessageId: String(row.user_message_id),
      assistantMessageId: String(row.assistant_message_id),
      attemptId: String(row.generation_attempt_id),
    };
  }

  async loadContextSource(
    workOrderId: string,
    jobId: string | null,
    includeFrontOffice: boolean
  ): Promise<LoadedContext> {
    const { data: workOrder, error: workOrderError } = await this.session
      .from("work_order")
      .select(
        "work_order_id, work_order_number, status, lifecycle_state, mileage, mileage_unit, internal_notes, motorcycle_id"
      )
      .eq("work_order_id", workOrderId)
      .single();
    throwQuery(workOrderError);
    if (!workOrder) throw new Error("WORK_ORDER_NOT_FOUND");
    const { data: motorcycle, error: motorcycleError } = await this.session
      .from("motorcycle")
      .select("motorcycle_id, year, make, model, colour, odometer_unit, notes")
      .eq("motorcycle_id", workOrder.motorcycle_id)
      .single();
    throwQuery(motorcycleError);
    if (!motorcycle) throw new Error("MOTORCYCLE_NOT_FOUND");
    // Customer identity/contact and the full VIN are loaded only to build
    // redaction terms after application authorization; they never enter source.
    const { data: redactionMotorcycle, error: redactionMotorcycleError } =
      await this.admin
        .from("motorcycle")
        .select("customer_id, vin")
        .eq("motorcycle_id", workOrder.motorcycle_id)
        .single();
    throwQuery(redactionMotorcycleError);
    if (!redactionMotorcycle) throw new Error("MOTORCYCLE_NOT_FOUND");
    const { data: customer, error: customerError } = await this.admin
      .from("customer")
      .select("first_name, last_name, email, phone, address")
      .eq("customer_id", redactionMotorcycle.customer_id)
      .single();
    throwQuery(customerError);
    if (!customer) throw new Error("CUSTOMER_NOT_FOUND");

    let jobsQuery = this.session
      .from("job")
      .select(
        "job_id, work_order_id, origin, service_name_snapshot, status, work_state, notes, completed_at"
      )
      .eq("work_order_id", workOrderId);
    if (jobId) jobsQuery = jobsQuery.eq("job_id", jobId);
    const { data: jobs, error: jobsError } = await jobsQuery;
    throwQuery(jobsError);
    const jobRows = (jobs ?? []) as Array<Record<string, unknown>>;
    if (jobId && jobRows.length !== 1) throw new Error("JOB_NOT_FOUND");
    const jobIds = jobRows.map((job) => String(job.job_id));

    const [
      serviceInfoResult,
      inspectionResult,
      notesResult,
      recommendationsResult,
      qualityResult,
      safetyResult,
      checklistResult,
      partsResult,
      proofResult,
    ] = await Promise.all([
      this.session
        .from("motorcycle_service_information")
        .select(
          "oil_filter, oil_type, oil_capacity, air_filter, spark_plugs, front_brake_pads, rear_brake_pads, front_tire_size, rear_tire_size, chain, battery, notes"
        )
        .eq("motorcycle_id", motorcycle.motorcycle_id)
        .maybeSingle(),
      this.session
        .from("inspection")
        .select(
          "inspection_id, work_order_id, completed_at, results:inspection_result(inspection_result_id, category_snapshot, item_name_snapshot, display_order_snapshot, status, measurement, notes)"
        )
        .eq("work_order_id", workOrderId)
        .maybeSingle(),
      this.session
        .from("technician_note")
        .select("technician_note_id, work_order_id, job_id, note_type, note, created_at")
        .eq("work_order_id", workOrderId),
      this.session
        .from("recommendation")
        .select(
          "recommendation_id, work_order_id, description, severity, status, disposition, notes, converted_job_id"
        )
        .eq("work_order_id", workOrderId),
      this.session
        .from("quality_check_attempt")
        .select("attempt_id, work_order_id, outcome, checklist, notes, performed_at")
        .eq("work_order_id", workOrderId),
      this.session
        .from("safety_check_attempt")
        .select("attempt_id, work_order_id, outcome, checklist, notes, performed_at")
        .eq("work_order_id", workOrderId),
      jobIds.length
        ? this.session
            .from("job_checklist_item")
            .select("job_checklist_item_id, job_id, title, checked_at")
            .in("job_id", jobIds)
        : Promise.resolve({ data: [], error: null }),
      jobIds.length
        ? this.session
            .from("job_part_requirement")
            .select(
              [
                "requirement_id",
                "job_id",
                "description",
                "part_number",
                "quantity_required",
                "quantity_received",
                "quantity_allocated",
                "quantity_installed",
                "state",
                ...(includeFrontOffice ? ["sell_price_cents"] : []),
              ].join(", ")
            )
            .in("job_id", jobIds)
        : Promise.resolve({ data: [], error: null }),
      jobIds.length
        ? this.session
            .from("intake_photo")
            .select("photo_id, job_id, category")
            .eq("work_order_id", workOrderId)
            .in("job_id", jobIds)
            .eq("category", "job_proof")
        : Promise.resolve({ data: [], error: null }),
    ]);
    for (const result of [
      serviceInfoResult,
      inspectionResult,
      notesResult,
      recommendationsResult,
      qualityResult,
      safetyResult,
      checklistResult,
      partsResult,
      proofResult,
    ]) {
      throwQuery(result.error);
    }

    const checklistRows = (checklistResult.data ?? []) as Array<Record<string, unknown>>;
    const partRows = (partsResult.data ?? []) as unknown as Array<
      Record<string, unknown>
    >;
    const proofRows = (proofResult.data ?? []) as Array<Record<string, unknown>>;
    const pricingByJob = includeFrontOffice
      ? await this.loadPricing(workOrderId, jobIds)
      : new Map<
          string,
          {
            prices?: NonNullable<DiagnosticsContextSource["jobs"][number]["prices"]>;
            authorization?: NonNullable<
              DiagnosticsContextSource["jobs"][number]["authorization"]
            >;
          }
        >();
    const inspection = inspectionResult.data as Record<string, unknown> | null;

    return {
      source: {
        workOrder: {
          workOrderId,
          workOrderNumber: String(workOrder.work_order_number ?? workOrderId),
          status: String(workOrder.status),
          lifecycleState: workOrder.lifecycle_state
            ? String(workOrder.lifecycle_state)
            : null,
          mileage: workOrder.mileage == null ? null : Number(workOrder.mileage),
          mileageUnit: workOrder.mileage_unit ? String(workOrder.mileage_unit) : null,
          complaint: null,
          internalNotes: workOrder.internal_notes
            ? String(workOrder.internal_notes)
            : null,
        },
        motorcycle: {
          year: Number(motorcycle.year),
          make: String(motorcycle.make),
          model: String(motorcycle.model),
          colour: motorcycle.colour ? String(motorcycle.colour) : null,
          odometerUnit: motorcycle.odometer_unit
            ? String(motorcycle.odometer_unit)
            : null,
          notes: motorcycle.notes ? String(motorcycle.notes) : null,
        },
        serviceInformation: serviceInfoResult.data
          ? {
              oilFilter: serviceInfoResult.data.oil_filter,
              oilType: serviceInfoResult.data.oil_type,
              oilCapacity: serviceInfoResult.data.oil_capacity,
              airFilter: serviceInfoResult.data.air_filter,
              sparkPlugs: serviceInfoResult.data.spark_plugs,
              frontBrakePads: serviceInfoResult.data.front_brake_pads,
              rearBrakePads: serviceInfoResult.data.rear_brake_pads,
              frontTireSize: serviceInfoResult.data.front_tire_size,
              rearTireSize: serviceInfoResult.data.rear_tire_size,
              chain: serviceInfoResult.data.chain,
              battery: serviceInfoResult.data.battery,
              notes: serviceInfoResult.data.notes,
            }
          : null,
        jobs: jobRows.map((job) => {
          const id = String(job.job_id);
          const commercial = pricingByJob.get(id);
          return {
            jobId: id,
            workOrderId,
            origin: String(job.origin),
            serviceName: String(job.service_name_snapshot),
            status: String(job.status),
            workState: job.work_state ? String(job.work_state) : null,
            notes: job.notes ? String(job.notes) : null,
            completedAt: job.completed_at ? String(job.completed_at) : null,
            ...(commercial?.prices ? { prices: commercial.prices } : {}),
            ...(commercial?.authorization
              ? { authorization: commercial.authorization }
              : {}),
            parts: partRows
              .filter((part) => String(part.job_id) === id)
              .map((part) => ({
                partId: String(part.requirement_id),
                description: String(part.description),
                partNumber: part.part_number ? String(part.part_number) : null,
                quantityRequired: Number(part.quantity_required),
                quantityReceived: Number(part.quantity_received),
                quantityAllocated: Number(part.quantity_allocated),
                quantityInstalled: Number(part.quantity_installed),
                state: String(part.state),
                sellPriceCents:
                  includeFrontOffice && part.sell_price_cents != null
                    ? Number(part.sell_price_cents)
                    : null,
              })),
            checklist: checklistRows
              .filter((item) => String(item.job_id) === id)
              .map((item) => ({
                checklistItemId: String(item.job_checklist_item_id),
                title: String(item.title),
                checkedAt: item.checked_at ? String(item.checked_at) : null,
              })),
            proof: {
              required: true,
              photoCount: proofRows.filter((photo) => String(photo.job_id) === id).length,
              exceptionRecorded: (notesResult.data ?? []).some(
                (note: Record<string, unknown>) =>
                  String(note.job_id) === id && note.note_type === "proof_exception"
              ),
            },
            verification: (notesResult.data ?? [])
              .filter(
                (note: Record<string, unknown>) =>
                  String(note.job_id) === id &&
                  VERIFICATION_NOTE_TYPES.has(String(note.note_type))
              )
              .map((note: Record<string, unknown>) => ({
                verificationId: String(note.technician_note_id),
                result: classifyVerificationNote(String(note.note)),
                notes: String(note.note),
                recordedAt: String(note.created_at),
              }))
              .sort(
                (a, b) =>
                  a.recordedAt.localeCompare(b.recordedAt) ||
                  a.verificationId.localeCompare(b.verificationId)
              ),
          };
        }),
        inspection: inspection
          ? {
              inspectionId: String(inspection.inspection_id),
              workOrderId,
              completedAt: inspection.completed_at
                ? String(inspection.completed_at)
                : null,
              results: ((inspection.results ?? []) as Array<Record<string, unknown>>).map(
                (result) => ({
                  inspectionResultId: String(result.inspection_result_id),
                  category: String(result.category_snapshot),
                  itemName: String(result.item_name_snapshot),
                  displayOrder: Number(result.display_order_snapshot),
                  status: result.status ? String(result.status) : null,
                  measurement: result.measurement ? String(result.measurement) : null,
                  notes: result.notes ? String(result.notes) : null,
                })
              ),
            }
          : null,
        technicianNotes: (notesResult.data ?? [])
          .filter(
            (note: Record<string, unknown>) =>
              !jobId || note.job_id == null || String(note.job_id) === jobId
          )
          .map((note: Record<string, unknown>) => ({
            technicianNoteId: String(note.technician_note_id),
            workOrderId,
            jobId: note.job_id ? String(note.job_id) : null,
            noteType: String(note.note_type),
            note: String(note.note),
            createdAt: String(note.created_at),
          })),
        recommendations: (recommendationsResult.data ?? []).map(
          (recommendation: Record<string, unknown>) => ({
            recommendationId: String(recommendation.recommendation_id),
            workOrderId,
            jobId: recommendation.converted_job_id
              ? String(recommendation.converted_job_id)
              : null,
            description: String(recommendation.description),
            severity: String(recommendation.severity),
            status: String(recommendation.status),
            disposition: recommendation.disposition
              ? String(recommendation.disposition)
              : null,
            notes: recommendation.notes ? String(recommendation.notes) : null,
          })
        ),
        checks: {
          quality: (qualityResult.data ?? []).map((check: Record<string, unknown>) => ({
            attemptId: String(check.attempt_id),
            workOrderId,
            outcome: String(check.outcome),
            checklist: check.checklist,
            notes: check.notes ? String(check.notes) : null,
            performedAt: String(check.performed_at),
          })),
          safety: (safetyResult.data ?? []).map((check: Record<string, unknown>) => ({
            attemptId: String(check.attempt_id),
            workOrderId,
            outcome: String(check.outcome),
            checklist: check.checklist,
            notes: check.notes ? String(check.notes) : null,
            performedAt: String(check.performed_at),
          })),
        },
      },
      redactTerms: {
        customerName: [customer.first_name, customer.last_name].filter(Boolean).join(" "),
        email: customer.email ? String(customer.email) : null,
        phone: customer.phone ? String(customer.phone) : null,
        address: customer.address ? String(customer.address) : null,
        fullVin: redactionMotorcycle.vin ? String(redactionMotorcycle.vin) : null,
      },
    };
  }

  private async loadPricing(
    workOrderId: string,
    jobIds: string[]
  ): Promise<
    Map<
      string,
      {
        prices?: NonNullable<DiagnosticsContextSource["jobs"][number]["prices"]>;
        authorization?: NonNullable<
          DiagnosticsContextSource["jobs"][number]["authorization"]
        >;
      }
    >
  > {
    const result = new Map();
    if (jobIds.length === 0) return result;
    const { data: estimate, error } = await this.session
      .from("estimate")
      .select("current_version_id, currency")
      .eq("work_order_id", workOrderId)
      .in("status", ["presented", "confirmed"])
      .maybeSingle();
    throwQuery(error);
    if (!estimate?.current_version_id) return result;
    const [
      { data: prices, error: priceError },
      { data: decisions, error: decisionError },
    ] = await Promise.all([
      this.session
        .from("estimate_job")
        .select(
          "job_id, labor_cents, parts_cents, fees_cents, discount_cents, tax_cents, total_cents"
        )
        .eq("estimate_version_id", estimate.current_version_id)
        .in("job_id", jobIds),
      this.session
        .from("estimate_job_decision")
        .select("job_id, decision, decided_at, method, reason")
        .eq("estimate_version_id", estimate.current_version_id)
        .in("job_id", jobIds),
    ]);
    throwQuery(priceError);
    throwQuery(decisionError);
    for (const price of (prices ?? []) as Array<Record<string, unknown>>) {
      result.set(String(price.job_id), {
        prices: {
          currency: String(estimate.currency),
          laborCents: Number(price.labor_cents),
          partsCents: Number(price.parts_cents),
          feesCents: Number(price.fees_cents),
          discountCents: Number(price.discount_cents),
          taxCents: Number(price.tax_cents),
          totalCents: Number(price.total_cents),
        },
      });
    }
    for (const decision of (decisions ?? []) as Array<Record<string, unknown>>) {
      const id = String(decision.job_id);
      result.set(id, {
        ...(result.get(id) ?? {}),
        authorization: {
          decision: String(decision.decision),
          decidedAt: String(decision.decided_at),
          method: decision.method ? String(decision.method) : null,
          reason: decision.reason ? String(decision.reason) : null,
        },
      });
    }
    return result;
  }

  async loadPhotoRows(
    workOrderId: string,
    photoIds: string[]
  ): Promise<DiagnosticsPhotoRow[]> {
    if (photoIds.length === 0) return [];
    const { data, error } = await this.session
      .from("intake_photo")
      .select(
        "photo_id, work_order_id, job_id, category, storage_path, thumb_storage_path"
      )
      .eq("work_order_id", workOrderId)
      .in("photo_id", photoIds);
    throwQuery(error);
    return ((data ?? []) as Array<Record<string, unknown>>).map((photo) => ({
      photoId: String(photo.photo_id),
      workOrderId: String(photo.work_order_id),
      jobId: photo.job_id ? String(photo.job_id) : null,
      category: String(photo.category),
      storagePath: String(photo.storage_path),
      thumbStoragePath: photo.thumb_storage_path
        ? String(photo.thumb_storage_path)
        : null,
    }));
  }

  async downloadPhoto(
    storagePath: string,
    options: { maxBytes: number }
  ): Promise<Uint8Array> {
    const { data, error } = await this.session.storage
      .from("intake-photos")
      .download(storagePath);
    if (error || !data) {
      throw new Error("DIAGNOSTICS_IMAGE_NOT_FOUND");
    }
    if (data.size > options.maxBytes) {
      throw new Error("DIAGNOSTICS_IMAGE_TOO_LARGE");
    }
    return new Uint8Array(await data.arrayBuffer());
  }

  async loadLatestSuccessfulModel(
    locationId: string,
    excludeMessageId: string
  ): Promise<LatestSuccessfulModel | null> {
    const { data, error } = await this.admin
      .from("ai_assistant_message")
      .select(
        "requested_provider_model, provider_model, thread:ai_assistant_thread!inner(location_id)"
      )
      .eq("role", "assistant")
      .eq("generation_status", "ready")
      .eq("thread.location_id", locationId)
      .neq("ai_assistant_message_id", excludeMessageId)
      .not("provider_model", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    throwQuery(error);
    if (!data?.provider_model) return null;
    return {
      requestedModel: data.requested_provider_model
        ? String(data.requested_provider_model)
        : null,
      resolvedModel: String(data.provider_model),
    };
  }

  async recordModelChangeAudit(input: {
    actorUserId: string;
    locationId: string;
    messageId: string;
    previousModel: string;
    requestedModel: string;
    resolvedModel: string;
    promptVersion: string;
    acceptanceRerunRequired: true;
    scenarioCount: number;
  }): Promise<void> {
    const { data: existing, error } = await this.admin
      .from("audit_log")
      .select("audit_id")
      .eq("location_id", input.locationId)
      .eq("action", "ask_otomoto_model_alias_changed")
      .contains("new_value", { resolved_model: input.resolvedModel })
      .limit(1)
      .maybeSingle();
    throwQuery(error);
    if (existing) return;

    await addAuditLog(this.admin, {
      actor_user_id: input.actorUserId,
      location_id: input.locationId,
      action: "ask_otomoto_model_alias_changed",
      entity_type: "ai_assistant_message",
      entity_id: input.messageId,
      description: "Ask OTOMOTO resolved model changed",
      old_value: { resolved_model: input.previousModel },
      new_value: {
        requested_model: input.requestedModel,
        resolved_model: input.resolvedModel,
        prompt_version: input.promptVersion,
        acceptance_rerun_required: input.acceptanceRerunRequired,
        scenario_count: input.scenarioCount,
      },
    });
  }
}

async function defaultRepository(): Promise<DiagnosticsAssistantRepository> {
  return new SupabaseDiagnosticsRepository(
    await createClient(),
    createDiagnosticsAdminClient
  );
}

function defaultInternalRepository(): DiagnosticsAssistantRepository {
  const admin = createDiagnosticsAdminClient();
  return new SupabaseDiagnosticsRepository(admin, () => admin);
}

function safeFailureCode(error: unknown): string {
  const value =
    error instanceof Error
      ? error.message
      : error && typeof error === "object" && "message" in error
        ? String(error.message)
        : "";
  const domainCode =
    /^(?:(?:ASK_OTOMOTO|DIAGNOSTICS|WORK_ORDER|JOB|PHOTO)_[A-Z0-9_]+|RATE_LIMITED|FOREIGN_LOCATION|FORBIDDEN|UNAUTHORIZED)$/;
  const exact = domainCode.test(value)
    ? value
    : value
        .match(
          /\b(?:(?:ASK_OTOMOTO|DIAGNOSTICS|WORK_ORDER|JOB|PHOTO)_[A-Z0-9_]+|RATE_LIMITED|FOREIGN_LOCATION|FORBIDDEN|UNAUTHORIZED)\b/
        )
        ?.find((candidate) => domainCode.test(candidate));
  return exact?.slice(0, 120) ?? "ASK_OTOMOTO_LIFECYCLE_FAILED";
}

export function diagnosticsSafeFailureCode(error: unknown): string {
  return safeFailureCode(error);
}

function stablePublicError(error: unknown): Error {
  return new Error(safeFailureCode(error));
}

function defaultRateLimit(userId: string): RateLimitResult {
  return rateLimit({
    key: `ask-otomoto:${userId}`,
    limit: ASK_OTOMOTO_RATE_LIMIT,
    windowMs: ASK_OTOMOTO_RATE_WINDOW_MS,
  });
}

async function defaultPrepareImages(
  input: {
    workOrderId: string;
    jobId: string | null;
    selections: Array<{ photoId: string; purpose: string }>;
    redactTerms: LoadedContext["redactTerms"];
  },
  repository: DiagnosticsAssistantRepository
): Promise<DiagnosticsImagePreparationResult> {
  return prepareDiagnosticsImages(
    {
      workOrderId: input.workOrderId,
      jobId: input.jobId,
      selections: input.selections,
      redactTerms: input.redactTerms,
    },
    {
      loadRows: (ids) => repository.loadPhotoRows(input.workOrderId, ids),
      download: (path, options) => repository.downloadPhoto(path, options),
    }
  );
}

async function requireScope(
  repository: DiagnosticsAssistantRepository,
  user: AppUser,
  workOrderId: string,
  mode: AiAssistantMode,
  access: DiagnosticsAccessKind
): Promise<DiagnosticsWorkOrderScope> {
  const scope = await repository.loadWorkOrderScope(workOrderId);
  if (!scope) throw new Error("WORK_ORDER_NOT_FOUND");
  assertDiagnosticsAccess(user, scope, mode, access);
  return scope;
}

async function assertJob(
  repository: DiagnosticsAssistantRepository,
  workOrderId: string,
  jobId: string | null
): Promise<void> {
  if (!jobId) return;
  const job = await repository.loadJob(workOrderId, jobId);
  if (!job || job.workOrderId !== workOrderId) throw new Error("JOB_NOT_FOUND");
}

async function assertThread(
  repository: DiagnosticsAssistantRepository,
  workOrderId: string,
  threadId: string
): Promise<DiagnosticsThreadWorkspace> {
  const workspace = await repository.loadThread(workOrderId, threadId);
  if (!workspace) throw new Error("ASK_OTOMOTO_THREAD_NOT_FOUND");
  return workspace;
}

async function requireThreadWrite(
  repository: DiagnosticsAssistantRepository,
  user: AppUser,
  workOrderId: string,
  threadId: string
): Promise<{
  workOrder: DiagnosticsWorkOrderScope;
  workspace: DiagnosticsThreadWorkspace;
}> {
  const workspace = await assertThread(repository, workOrderId, threadId);
  const workOrder = await repository.loadWorkOrderScope(workOrderId);
  if (!workOrder) throw new Error("WORK_ORDER_NOT_FOUND");
  assertDiagnosticsThreadWrite(user, workOrder, workspace.thread);
  return { workOrder, workspace };
}

function requiredPhaseForRetry(
  thread: DiagnosticsThreadSummary,
  generation: GenerationInput
): DiagnosticsGenerationRequest["requiredPhase"] {
  const isAutomaticJobSeed =
    thread.triggerType === "job_completed" &&
    thread.jobId !== null &&
    thread.triggerEntityId === thread.jobId &&
    generation.history.length === 0 &&
    generation.photos.length === 0 &&
    generation.userMessage === JOB_COMPLETION_SEED_REQUEST;
  return isAutomaticJobSeed ? "closure_report" : undefined;
}

export function createDiagnosticsAssistantService(
  dependencies: DiagnosticsAssistantDependencies = {}
) {
  const authenticate = dependencies.requireUser ?? requireSessionUser;
  const now = dependencies.now ?? (() => new Date());
  const generate = dependencies.generateDraft ?? generateDiagnosticsDraft;
  const prepare = dependencies.prepareImages ?? defaultPrepareImages;
  const consumeRateLimit = dependencies.consumeRateLimit ?? defaultRateLimit;
  const assertConfigured =
    dependencies.assertConfigured ?? (() => void getDiagnosticsConfig());
  const retryStaleAfterMs = () =>
    (dependencies.providerTimeoutMs ?? getDiagnosticsTimeoutMs()) *
      (DIAGNOSTICS_PROVIDER_MAX_RETRIES + 1) +
    ASK_OTOMOTO_STALE_MARGIN_MS;
  const recoveryStaleAfterMs = () => {
    try {
      return retryStaleAfterMs();
    } catch {
      return (
        DEFAULT_DIAGNOSTICS_TIMEOUT_MS * (DIAGNOSTICS_PROVIDER_MAX_RETRIES + 1) +
        ASK_OTOMOTO_STALE_MARGIN_MS
      );
    }
  };
  const repo = async () => dependencies.repository ?? (await defaultRepository());

  function recoveryDeadline(updatedAt: string, delayMs: number): string | null {
    const timestamp = Date.parse(updatedAt);
    return Number.isFinite(timestamp)
      ? new Date(timestamp + delayMs).toISOString()
      : null;
  }

  function withRecoveryDeadlines(
    thread: DiagnosticsThreadSummary
  ): DiagnosticsThreadSummary {
    return {
      ...thread,
      retryableAt:
        thread.status === "generating"
          ? recoveryDeadline(thread.updatedAt, recoveryStaleAfterMs())
          : null,
      automaticRecoveryAt:
        thread.status === "pending" && thread.triggerType !== null
          ? recoveryDeadline(thread.updatedAt, ASK_OTOMOTO_PENDING_RECOVERY_GRACE_MS)
          : null,
    };
  }

  async function loadClaimedGeneration(
    repository: DiagnosticsAssistantRepository,
    workOrderId: string,
    threadId: string,
    turn: TurnRecord
  ): Promise<GenerationInput> {
    try {
      const generation = await repository.loadGenerationInput(
        workOrderId,
        threadId,
        turn.userMessageId,
        turn.assistantMessageId
      );
      return { ...generation, attemptId: turn.attemptId };
    } catch (error) {
      try {
        await repository.failGeneration({
          threadId,
          assistantMessageId: turn.assistantMessageId,
          attemptId: turn.attemptId,
          safeErrorCode: safeFailureCode(error),
        });
      } catch {
        // A concurrent completion/retry may win; preserve its terminal state.
      }
      throw stablePublicError(error);
    }
  }

  async function generateTurn(input: {
    actor: Pick<AppUser, "user_id">;
    repository: DiagnosticsAssistantRepository;
    scope: DiagnosticsWorkOrderScope;
    thread: DiagnosticsThreadSummary;
    generation: GenerationInput;
    requiredPhase?: DiagnosticsGenerationRequest["requiredPhase"];
  }): Promise<DiagnosticsMessageView> {
    const contextAsOf = now().toISOString();
    let renderedBody: string;
    let response: DiagnosticsGenerationResult;
    let priorModel: LatestSuccessfulModel | null = null;
    try {
      const loaded = await input.repository.loadContextSource(
        input.thread.workOrderId,
        input.thread.jobId,
        input.thread.audience === "front_office"
      );
      const shaped = shapeDiagnosticsContext(loaded.source, {
        mode: input.thread.mode,
        workOrderId: input.thread.workOrderId,
        jobId: input.thread.jobId,
        serverNowIso: contextAsOf,
        redactTerms: loaded.redactTerms,
      });
      const safeUserMessage = redactDiagnosticsText(
        input.generation.userMessage,
        loaded.redactTerms
      );
      const safeHistory = input.generation.history.map((message) => ({
        ...message,
        content: redactDiagnosticsText(message.content, loaded.redactTerms),
      }));
      const safeSelections = input.generation.photos.map((photo) => ({
        ...photo,
        purpose: redactDiagnosticsText(photo.purpose, loaded.redactTerms),
      }));
      const prepared = await prepare(
        {
          workOrderId: input.thread.workOrderId,
          jobId: input.thread.jobId,
          selections: safeSelections,
          redactTerms: loaded.redactTerms,
        },
        input.repository
      );
      try {
        priorModel = await input.repository.loadLatestSuccessfulModel(
          input.scope.locationId,
          input.generation.assistantMessageId
        );
      } catch {
        priorModel = null;
      }
      response = await generate({
        mode: input.thread.mode,
        requiredPhase: input.requiredPhase,
        staffUserId: input.actor.user_id,
        workOrderContext: shaped.context,
        userMessage: safeUserMessage,
        history: safeHistory,
        images: prepared.images,
      });
      renderedBody = renderDiagnosticsDraft(response.response);
      await input.repository.completeGeneration({
        threadId: input.thread.threadId,
        assistantMessageId: input.generation.assistantMessageId,
        attemptId: input.generation.attemptId,
        body: renderedBody,
        response,
        contextAsOf,
        phase: response.response.phase,
        requestedInput: response.response.requested_input,
      });
    } catch (error) {
      try {
        await input.repository.failGeneration({
          threadId: input.thread.threadId,
          assistantMessageId: input.generation.assistantMessageId,
          attemptId: input.generation.attemptId,
          safeErrorCode: safeFailureCode(error),
        });
      } catch {
        // The CAS may lose to completion/retry; never expose database details.
      }
      throw stablePublicError(error);
    }

    if (priorModel && priorModel.resolvedModel !== response.resolvedModel) {
      try {
        await input.repository.recordModelChangeAudit?.({
          actorUserId: input.actor.user_id,
          locationId: input.scope.locationId,
          messageId: input.generation.assistantMessageId,
          previousModel: priorModel.resolvedModel,
          requestedModel: response.requestedModel,
          resolvedModel: response.resolvedModel,
          promptVersion: response.promptVersion,
          acceptanceRerunRequired: true,
          scenarioCount: ASK_OTOMOTO_ACCEPTANCE_SCENARIO_COUNT,
        });
      } catch {
        // Metadata-only audit is best effort after the response is committed.
      }
    }

    try {
      const workspace = await assertThread(
        input.repository,
        input.thread.workOrderId,
        input.thread.threadId
      );
      const completed = workspace.messages.find(
        (message) => message.messageId === input.generation.assistantMessageId
      );
      if (!completed) throw new Error("ASK_OTOMOTO_TURN_NOT_FOUND");
      return completed;
    } catch {
      // A read-after-write failure cannot turn a committed response into a
      // visible generation failure. Return the committed serializable view.
      return {
        messageId: input.generation.assistantMessageId,
        threadId: input.thread.threadId,
        role: "assistant",
        body: renderedBody,
        generationStatus: "ready",
        requestedInput: response.response.requested_input,
        phase: response.response.phase,
        safeErrorCode: null,
        parentUserMessageId: input.generation.userMessageId,
        requestedProviderModel: response.requestedModel,
        providerModel: response.resolvedModel,
        createdAt: contextAsOf,
        updatedAt: contextAsOf,
        photos: input.generation.selectedPhotoMetadata ?? [],
      };
    }
  }

  return {
    async listThreads(
      workOrderId: string,
      readView?: DiagnosticsTrustedReadView
    ): Promise<DiagnosticsThreadSummary[]> {
      const actor = await authenticate();
      const user = readActorForView(actor, readView);
      const repository = await repo();
      const scope = await repository.loadWorkOrderScope(uuidSchema.parse(workOrderId));
      if (!scope) throw new Error("WORK_ORDER_NOT_FOUND");
      const rows = await repository.listThreads(workOrderId);
      return rows
        .filter((thread) => {
          try {
            assertDiagnosticsAccess(user, scope, thread.mode, "read");
            return true;
          } catch {
            return false;
          }
        })
        .map(withRecoveryDeadlines);
    },

    async loadThread(
      workOrderId: string,
      threadId: string,
      readView?: DiagnosticsTrustedReadView
    ): Promise<DiagnosticsThreadWorkspace> {
      const actor = await authenticate();
      const user = readActorForView(actor, readView);
      const repository = await repo();
      const parsedWorkOrderId = uuidSchema.parse(workOrderId);
      const workspace = await assertThread(
        repository,
        parsedWorkOrderId,
        uuidSchema.parse(threadId)
      );
      await requireScope(
        repository,
        user,
        parsedWorkOrderId,
        workspace.thread.mode,
        "read"
      );
      const readyAssistantIds = workspace.messages
        .filter(
          (message) =>
            message.role === "assistant" && message.generationStatus === "ready"
        )
        .map((message) => message.messageId);
      let promoted = new Map<string, string>();
      if (readyAssistantIds.length > 0) {
        try {
          promoted = await repository.listPromotedNoteIds(
            parsedWorkOrderId,
            readyAssistantIds
          );
        } catch (error) {
          // History stays readable; a repeat save is still refused server-side.
          console.warn("ask otomoto promotion lookup failed", {
            workOrderId: parsedWorkOrderId,
            threadId: workspace.thread.threadId,
            code:
              error instanceof Error && /^[A-Z][A-Z0-9_]{2,60}$/.test(error.message)
                ? error.message
                : "UNKNOWN",
          });
        }
      }
      return {
        thread: withRecoveryDeadlines(workspace.thread),
        messages: workspace.messages.map((message) => ({
          ...message,
          promotedNoteId: promoted.get(message.messageId) ?? null,
        })),
      };
    },

    async authorizeThreadWrite(
      workOrderId: string,
      threadId: string
    ): Promise<DiagnosticsThreadWorkspace> {
      const user = await authenticate();
      const repository = await repo();
      const authorized = await requireThreadWrite(
        repository,
        user,
        uuidSchema.parse(workOrderId),
        uuidSchema.parse(threadId)
      );
      return authorized.workspace;
    },

    async authorizeAutomaticTriggerRecovery(raw: {
      workOrderId: string;
      threadId: string;
    }): Promise<{
      actor: DiagnosticsTriggerActorSnapshot;
      trigger:
        | {
            workOrderId: string;
            threadId: string;
            trigger: "inspection_completion";
            triggerEntityId: string;
          }
        | {
            workOrderId: string;
            threadId: string;
            jobId: string;
            trigger: "job_completion";
            triggerEntityId: string;
          };
    }> {
      const user = await authenticate();
      const input = retryDiagnosticsTurnSchema.parse(raw);
      const repository = await repo();
      const { workOrder, workspace } = await requireThreadWrite(
        repository,
        user,
        input.workOrderId,
        input.threadId
      );
      const thread = workspace.thread;
      if (
        thread.status !== "pending" ||
        workspace.messages.length !== 0 ||
        thread.mode !== "shop" ||
        thread.audience !== "technical" ||
        !thread.triggerType ||
        !thread.triggerEntityId ||
        !thread.createdByUserId
      ) {
        throw new Error("ASK_OTOMOTO_RECOVERY_NOT_FOUND");
      }
      const recoveryAt = recoveryDeadline(
        thread.updatedAt,
        ASK_OTOMOTO_PENDING_RECOVERY_GRACE_MS
      );
      if (!recoveryAt || now().getTime() < Date.parse(recoveryAt)) {
        throw new Error("ASK_OTOMOTO_RECOVERY_NOT_READY");
      }
      if (
        thread.triggerType === "job_completed" &&
        (thread.jobId === null || thread.jobId !== thread.triggerEntityId)
      ) {
        throw new Error("ASK_OTOMOTO_TRIGGER_SCOPE_MISMATCH");
      }
      if (
        !(await repository.triggerEntityBelongsToWorkOrder(
          input.workOrderId,
          thread.triggerType,
          thread.triggerEntityId
        ))
      ) {
        throw new Error("ASK_OTOMOTO_TRIGGER_NOT_FOUND");
      }
      if (
        !(await repository.isActiveUserAtLocation(
          thread.createdByUserId,
          workOrder.locationId
        ))
      ) {
        throw new Error("ASK_OTOMOTO_TRIGGER_CREATOR_INACTIVE");
      }
      assertConfigured();
      const actor = {
        userId: thread.createdByUserId,
        locationId: workOrder.locationId,
      };
      return thread.triggerType === "job_completed"
        ? {
            actor,
            trigger: {
              workOrderId: input.workOrderId,
              threadId: input.threadId,
              jobId: thread.jobId!,
              trigger: "job_completion",
              triggerEntityId: thread.triggerEntityId,
            },
          }
        : {
            actor,
            trigger: {
              workOrderId: input.workOrderId,
              threadId: input.threadId,
              trigger: "inspection_completion",
              triggerEntityId: thread.triggerEntityId,
            },
          };
    },

    async createThread(
      raw: z.input<typeof createDiagnosticsThreadSchema>
    ): Promise<DiagnosticsThreadSummary> {
      const user = await authenticate();
      const input = createDiagnosticsThreadSchema.parse(raw);
      const repository = await repo();
      const workOrder = await requireScope(
        repository,
        user,
        input.workOrderId,
        input.mode,
        "write"
      );
      await assertJob(repository, input.workOrderId, input.jobId ?? null);
      return repository.createThread({
        workOrderId: input.workOrderId,
        jobId: input.jobId ?? null,
        locationId: workOrder.locationId,
        mode: input.mode,
        audience: deriveDiagnosticsAudience(input.mode),
        createdByUserId: user.user_id,
      });
    },

    async submitTurn(
      raw: z.input<typeof submitDiagnosticsTurnSchema>
    ): Promise<DiagnosticsMessageView> {
      const user = await authenticate();
      const input = submitDiagnosticsTurnSchema.parse(raw);
      const repository = await repo();
      const authorized = await requireThreadWrite(
        repository,
        user,
        input.workOrderId,
        input.threadId
      );
      const workspace = authorized.workspace;
      if (
        workspace.thread.mode !== input.mode ||
        workspace.thread.jobId !== (input.jobId ?? null) ||
        workspace.thread.audience !== deriveDiagnosticsAudience(input.mode)
      ) {
        throw new Error("ASK_OTOMOTO_THREAD_SCOPE_MISMATCH");
      }
      const workOrder = authorized.workOrder;
      await assertJob(repository, input.workOrderId, input.jobId ?? null);
      if (!consumeRateLimit(user.user_id).success) throw new Error("RATE_LIMITED");
      const rows = await repository.loadPhotoRows(
        input.workOrderId,
        input.photos.map((photo) => photo.photoId)
      );
      if (rows.length !== input.photos.length) {
        throw new Error("DIAGNOSTICS_IMAGE_NOT_FOUND");
      }
      for (const row of rows) {
        if (row.workOrderId !== input.workOrderId) {
          throw new Error("DIAGNOSTICS_IMAGE_WORK_ORDER_MISMATCH");
        }
        if (input.jobId && row.jobId && row.jobId !== input.jobId) {
          throw new Error("DIAGNOSTICS_IMAGE_JOB_MISMATCH");
        }
        if (!ALLOWED_DIAGNOSTICS_PHOTO_CATEGORIES.has(row.category)) {
          throw new Error("DIAGNOSTICS_IMAGE_CATEGORY_NOT_ALLOWED");
        }
        if (
          (row.category === "job_work" || row.category === "job_proof") &&
          (!input.jobId || row.jobId !== input.jobId)
        ) {
          throw new Error(
            input.jobId
              ? "DIAGNOSTICS_IMAGE_JOB_MISMATCH"
              : "DIAGNOSTICS_IMAGE_JOB_REQUIRED"
          );
        }
      }
      let turn: TurnRecord;
      try {
        turn = await repository.beginTurn({
          workOrderId: input.workOrderId,
          threadId: input.threadId,
          userId: user.user_id,
          text: input.text,
          photos: input.photos.map((photo, sortOrder) => ({
            ...photo,
            sortOrder,
          })),
        });
      } catch (error) {
        throw stablePublicError(error);
      }
      const generation = await loadClaimedGeneration(
        repository,
        input.workOrderId,
        input.threadId,
        turn
      );
      return generateTurn({
        actor: user,
        repository,
        scope: workOrder,
        thread: workspace.thread,
        generation,
      });
    },

    async retryLatestFailed(
      raw: z.input<typeof retryDiagnosticsTurnSchema>
    ): Promise<DiagnosticsMessageView> {
      const user = await authenticate();
      const input = retryDiagnosticsTurnSchema.parse(raw);
      const repository = await repo();
      const authorized = await requireThreadWrite(
        repository,
        user,
        input.workOrderId,
        input.threadId
      );
      const workspace = authorized.workspace;
      const workOrder = authorized.workOrder;
      if (!consumeRateLimit(user.user_id).success) throw new Error("RATE_LIMITED");
      let turn: TurnRecord | null;
      try {
        turn = await repository.claimLatestRetry(
          input.workOrderId,
          input.threadId,
          retryStaleAfterMs()
        );
      } catch (error) {
        throw stablePublicError(error);
      }
      if (!turn) throw new Error("ASK_OTOMOTO_RETRY_NOT_FOUND");
      const generation = await loadClaimedGeneration(
        repository,
        input.workOrderId,
        input.threadId,
        turn
      );
      return generateTurn({
        actor: user,
        repository,
        scope: workOrder,
        thread: workspace.thread,
        generation,
        requiredPhase: requiredPhaseForRetry(workspace.thread, generation),
      });
    },

    /**
     * Internal continuation for a turn already claimed by a trusted,
     * server-owned trigger. It deliberately performs no session lookup.
     */
    async generateClaimedTurnForInternalTrigger(input: {
      actor: Pick<AppUser, "user_id">;
      repository: DiagnosticsAssistantRepository;
      scope: DiagnosticsWorkOrderScope;
      thread: DiagnosticsThreadSummary;
      turn: TurnRecord;
      requiredPhase?: DiagnosticsGenerationRequest["requiredPhase"];
    }): Promise<DiagnosticsMessageView> {
      const generation = await loadClaimedGeneration(
        input.repository,
        input.thread.workOrderId,
        input.thread.threadId,
        input.turn
      );
      return generateTurn({
        actor: input.actor,
        repository: input.repository,
        scope: input.scope,
        thread: input.thread,
        generation,
        requiredPhase: input.requiredPhase,
      });
    },
  };
}

export async function createOrReuseDiagnosticsTriggerThreadInternal(
  actor: AppUser,
  raw: {
    workOrderId: string;
    jobId?: string | null;
    mode: AiAssistantMode;
    trigger: "inspection_completion" | "job_completion";
    triggerEntityId: string;
  },
  dependencies: Pick<DiagnosticsAssistantDependencies, "repository"> = {}
): Promise<DiagnosticsThreadSummary> {
  const input = z
    .object({
      workOrderId: uuidSchema,
      jobId: nullableUuidSchema,
      mode: modeSchema,
      trigger: triggerSchema,
      triggerEntityId: uuidSchema,
    })
    .strict()
    .parse(raw);
  const repository = dependencies.repository ?? (await defaultRepository());
  const workOrder = await requireScope(
    repository,
    actor,
    input.workOrderId,
    input.mode,
    "write"
  );
  const triggerType: AiAssistantTriggerType =
    input.trigger === "inspection_completion" ? "inspection_completed" : "job_completed";
  if (input.trigger === "job_completion") {
    if (input.jobId !== input.triggerEntityId) {
      throw new Error("ASK_OTOMOTO_TRIGGER_NOT_FOUND");
    }
    await assertJob(repository, input.workOrderId, input.jobId ?? null);
  }
  if (
    !(await repository.triggerEntityBelongsToWorkOrder(
      input.workOrderId,
      triggerType,
      input.triggerEntityId
    ))
  ) {
    throw new Error("ASK_OTOMOTO_TRIGGER_NOT_FOUND");
  }
  const existing = await repository.findTriggerThread(
    input.workOrderId,
    triggerType,
    input.triggerEntityId
  );
  const assertExpectedTrigger = (
    thread: DiagnosticsThreadSummary
  ): DiagnosticsThreadSummary => {
    const jobMatches =
      input.trigger === "inspection_completion" || thread.jobId === (input.jobId ?? null);
    if (
      thread.workOrderId !== input.workOrderId ||
      thread.locationId !== workOrder.locationId ||
      !jobMatches ||
      thread.mode !== input.mode ||
      thread.audience !== deriveDiagnosticsAudience(input.mode) ||
      thread.triggerType !== triggerType ||
      thread.triggerEntityId !== input.triggerEntityId
    ) {
      throw new Error("ASK_OTOMOTO_TRIGGER_SCOPE_MISMATCH");
    }
    assertDiagnosticsThreadWrite(actor, workOrder, thread);
    return thread;
  };
  if (existing) return assertExpectedTrigger(existing);
  let createJobId = input.jobId ?? null;
  if (input.trigger === "inspection_completion" && createJobId) {
    const requestedJob = await repository.loadJob(input.workOrderId, createJobId);
    if (!requestedJob || requestedJob.workOrderId !== input.workOrderId) {
      createJobId = null;
    }
  }
  try {
    return await repository.createThread({
      workOrderId: input.workOrderId,
      jobId: createJobId,
      locationId: workOrder.locationId,
      mode: input.mode,
      audience: deriveDiagnosticsAudience(input.mode),
      createdByUserId: actor.user_id,
      triggerType,
      triggerEntityId: input.triggerEntityId,
    });
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code !== "23505") throw stablePublicError(error);
    let recovered: DiagnosticsThreadSummary | null;
    try {
      recovered = await repository.findTriggerThread(
        input.workOrderId,
        triggerType,
        input.triggerEntityId
      );
    } catch (recoveryError) {
      throw stablePublicError(recoveryError);
    }
    if (!recovered) throw stablePublicError(error);
    return assertExpectedTrigger(recovered);
  }
}

export const INSPECTION_COMPLETION_SEED_REQUEST = [
  "Review the completed arrival inspection.",
  "Clearly distinguish reported symptoms from measured or observed findings,",
  "and distinguish confirmed, probable, and possible conclusions.",
  "Preserve every explicit not-inspected, not-tested, or incomplete item as such.",
  "Suggest the single highest-value safe discriminating check or input.",
  "Make no statutory pass/fail or roadworthiness conclusion.",
  "Return exactly one NEXT STEP using the response schema.",
].join(" ");

export const JOB_COMPLETION_SEED_REQUEST = [
  "Review only recorded job/work-order facts after explicit job completion.",
  "Distinguish reported repair or work from actual verification evidence.",
  "If no comparable retest is stored, use the exact wording",
  '"repair performed; verification pending".',
  "Ask for the single immediate verification/review input.",
  "Draft a compact Shop Log entry and use the closure_report phase.",
  "Make no pass/fail, QC, release, or roadworthiness claim.",
  "Do not automatically attach photos; recorded photo metadata or counts are context only.",
].join(" ");

export type DiagnosticsTriggerActorSnapshot = {
  userId: string;
  locationId: string;
};

type DiagnosticsInternalGenerationDependencies = Pick<
  DiagnosticsAssistantDependencies,
  "repository" | "generateDraft" | "prepareImages" | "now" | "providerTimeoutMs"
>;

/**
 * Generate the seed response for an exact trigger thread after the originating
 * action has authenticated, authorized, completed the domain mutation, and
 * created/reused that thread. This path is request-independent by design.
 */
export async function generateDiagnosticsTriggerResponseInternal(
  actor: DiagnosticsTriggerActorSnapshot,
  raw:
    | {
        workOrderId: string;
        threadId: string;
        trigger: "inspection_completion";
        triggerEntityId: string;
      }
    | {
        workOrderId: string;
        threadId: string;
        jobId: string;
        trigger: "job_completion";
        triggerEntityId: string;
      },
  dependencies: DiagnosticsInternalGenerationDependencies = {}
): Promise<DiagnosticsMessageView | null> {
  const input = z
    .discriminatedUnion("trigger", [
      z
        .object({
          workOrderId: uuidSchema,
          threadId: uuidSchema,
          trigger: z.literal("inspection_completion"),
          triggerEntityId: uuidSchema,
        })
        .strict(),
      z
        .object({
          workOrderId: uuidSchema,
          threadId: uuidSchema,
          jobId: uuidSchema,
          trigger: z.literal("job_completion"),
          triggerEntityId: uuidSchema,
        })
        .strict(),
    ])
    .parse(raw);
  if (input.trigger === "job_completion" && input.jobId !== input.triggerEntityId) {
    throw new Error("ASK_OTOMOTO_TRIGGER_SCOPE_MISMATCH");
  }
  const trustedActor = z
    .object({ userId: uuidSchema, locationId: uuidSchema })
    .strict()
    .parse(actor);
  const repository = dependencies.repository ?? defaultInternalRepository();
  const workspace = await repository.loadThread(input.workOrderId, input.threadId);
  if (!workspace) throw new Error("ASK_OTOMOTO_THREAD_NOT_FOUND");
  const scope = await repository.loadWorkOrderScope(input.workOrderId);
  if (!scope) throw new Error("WORK_ORDER_NOT_FOUND");

  const validateThread = (
    candidate: DiagnosticsThreadWorkspace
  ): DiagnosticsThreadSummary => {
    const candidateThread = candidate.thread;
    const triggerType: AiAssistantTriggerType =
      input.trigger === "inspection_completion"
        ? "inspection_completed"
        : "job_completed";
    const jobMatches =
      input.trigger === "job_completion"
        ? candidateThread.jobId === input.jobId &&
          scope.jobs.some((job) => job.jobId === input.jobId)
        : candidateThread.jobId === null ||
          scope.jobs.some((job) => job.jobId === candidateThread.jobId);
    if (
      candidateThread.threadId !== input.threadId ||
      candidateThread.workOrderId !== input.workOrderId ||
      candidateThread.locationId !== scope.locationId ||
      candidateThread.locationId !== trustedActor.locationId ||
      candidateThread.mode !== "shop" ||
      candidateThread.audience !== "technical" ||
      candidateThread.triggerType !== triggerType ||
      candidateThread.triggerEntityId !== input.triggerEntityId ||
      candidateThread.createdByUserId !== trustedActor.userId ||
      scope.locationStatus !== "active" ||
      !jobMatches
    ) {
      throw new Error("ASK_OTOMOTO_TRIGGER_SCOPE_MISMATCH");
    }
    return candidateThread;
  };
  const thread = validateThread(workspace);
  if (
    thread.status === "ready" ||
    thread.status === "generating" ||
    thread.status === "failed"
  ) {
    return null;
  }
  if (thread.status === "archived") {
    throw new Error("ASK_OTOMOTO_THREAD_ARCHIVED");
  }
  if (scope.status === "completed" || scope.status === "cancelled") {
    throw new Error("WORK_ORDER_LOCKED");
  }
  if (
    !(await repository.triggerEntityBelongsToWorkOrder(
      input.workOrderId,
      input.trigger === "inspection_completion"
        ? "inspection_completed"
        : "job_completed",
      input.triggerEntityId
    ))
  ) {
    throw new Error("ASK_OTOMOTO_TRIGGER_NOT_FOUND");
  }

  if (
    !(await repository.isActiveUserAtLocation(trustedActor.userId, thread.locationId))
  ) {
    throw new Error("ASK_OTOMOTO_TRIGGER_CREATOR_INACTIVE");
  }

  let turn: TurnRecord;
  if (thread.status === "pending") {
    const triggerType: AiAssistantTriggerType =
      input.trigger === "inspection_completion"
        ? "inspection_completed"
        : "job_completed";
    try {
      turn = await repository.beginSeedTurn({
        workOrderId: input.workOrderId,
        threadId: input.threadId,
        triggerType,
        triggerEntityId: input.triggerEntityId,
        userId: trustedActor.userId,
        text:
          input.trigger === "inspection_completion"
            ? INSPECTION_COMPLETION_SEED_REQUEST
            : JOB_COMPLETION_SEED_REQUEST,
      });
    } catch (error) {
      const stable = stablePublicError(error);
      if (stable.message !== "ASK_OTOMOTO_SEED_ALREADY_CLAIMED") throw stable;
      let reloaded: DiagnosticsThreadWorkspace | null;
      try {
        reloaded = await repository.loadThread(input.workOrderId, input.threadId);
      } catch (reloadError) {
        throw stablePublicError(reloadError);
      }
      if (!reloaded) throw new Error("ASK_OTOMOTO_THREAD_NOT_FOUND");
      const reloadedThread = validateThread(reloaded);
      if (
        reloadedThread.status === "generating" ||
        reloadedThread.status === "ready" ||
        reloadedThread.status === "failed"
      ) {
        return null;
      }
      throw stable;
    }
  } else {
    throw new Error("ASK_OTOMOTO_THREAD_NOT_WRITABLE");
  }

  const service = createDiagnosticsAssistantService({
    ...dependencies,
    repository,
  });
  return service.generateClaimedTurnForInternalTrigger({
    actor: { user_id: trustedActor.userId },
    repository,
    scope,
    thread,
    turn,
    requiredPhase: input.trigger === "job_completion" ? "closure_report" : undefined,
  });
}
