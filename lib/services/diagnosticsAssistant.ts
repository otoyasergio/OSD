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
} from "@/lib/database/types";
import { canViewClients, canViewPricing, isFloorTech } from "@/lib/permissions";
import {
  canViewerAccessWorkOrder,
  canViewerAccessWorkOrderLocation,
} from "@/lib/workOrders/assignmentVisibility";
import {
  shapeDiagnosticsContext,
  type DiagnosticsContextSource,
} from "@/lib/diagnostics/context";
import type { DiagnosticsRedactTerms } from "@/lib/diagnostics/redaction";
import {
  prepareDiagnosticsImages,
  type DiagnosticsImagePreparationResult,
  type DiagnosticsPhotoRow,
} from "@/lib/diagnostics/images";
import {
  generateDiagnosticsDraft,
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
  createdAt: string;
  updatedAt: string;
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
  providerModel: string | null;
  createdAt: string;
  updatedAt: string;
  photos: DiagnosticsMessagePhotoView[];
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
  threadId: string;
  userId: string;
  text: string;
  photos: Array<{ photoId: string; purpose: string; sortOrder: number }>;
};

type TurnRecord = {
  userMessageId: string;
  assistantMessageId: string;
};

type GenerationInput = {
  userMessageId: string;
  assistantMessageId: string;
  userMessage: string;
  photos: Array<{ photoId: string; purpose: string }>;
  history: DiagnosticsHistoryMessage[];
};

type LoadedContext = {
  source: DiagnosticsContextSource;
  redactTerms: DiagnosticsRedactTerms;
};

type CompleteGenerationInput = {
  threadId: string;
  assistantMessageId: string;
  body: string;
  response: DiagnosticsGenerationResult;
  contextAsOf: string;
  phase: AiAssistantPhase;
  requestedInput: unknown;
};

type FailedTurn = GenerationInput & {
  mode: AiAssistantMode;
  jobId: string | null;
};

export interface DiagnosticsAssistantRepository {
  loadWorkOrderScope(workOrderId: string): Promise<DiagnosticsWorkOrderScope | null>;
  listThreads(workOrderId: string): Promise<DiagnosticsThreadSummary[]>;
  loadThread(
    workOrderId: string,
    threadId: string
  ): Promise<DiagnosticsThreadWorkspace | null>;
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
  loadJob(workOrderId: string, jobId: string): Promise<DiagnosticsJobScope | null>;
  beginTurn(input: BeginTurnInput): Promise<TurnRecord>;
  loadGenerationInput(
    workOrderId: string,
    threadId: string,
    assistantMessageId: string
  ): Promise<GenerationInput>;
  completeGeneration(input: CompleteGenerationInput): Promise<void>;
  failGeneration(input: {
    threadId: string;
    assistantMessageId: string;
    safeErrorCode: string;
  }): Promise<void>;
  loadLatestFailedTurn(workOrderId: string, threadId: string): Promise<FailedTurn | null>;
  loadContextSource(
    workOrderId: string,
    jobId: string | null,
    includeFrontOffice: boolean
  ): Promise<LoadedContext>;
  loadPhotoRows(workOrderId: string, photoIds: string[]): Promise<DiagnosticsPhotoRow[]>;
  downloadPhoto(storagePath: string, options: { maxBytes: number }): Promise<Uint8Array>;
  recordModelChangeAudit?(input: {
    actorUserId: string;
    locationId: string;
    messageId: string;
    previousModel: string;
    resolvedModel: string;
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
  if (
    !canViewerAccessWorkOrderLocation({
      role: user.role,
      workOrderLocationId: workOrder.locationId,
      activeLocationId:
        access === "read" && !isFloorTech(user.role)
          ? workOrder.locationId
          : user.active_location_id,
      membershipLocationIds: user.location_ids,
    })
  ) {
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
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

const THREAD_COLUMNS =
  "ai_assistant_thread_id, work_order_id, job_id, location_id, mode, audience, status, diagnostic_phase, trigger_type, created_at, updated_at";
const MESSAGE_COLUMNS =
  "ai_assistant_message_id, thread_id, role, body, generation_status, requested_input, phase, safe_error_code, provider_model, created_at, updated_at";

function throwQuery(error: { message?: string; code?: string } | null): void {
  if (error) throw error;
}

function unwrapOne<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

class SupabaseDiagnosticsRepository implements DiagnosticsAssistantRepository {
  private adminClient: DbClient | null = null;

  constructor(
    private readonly session: DbClient,
    private readonly createAdmin: () => DbClient
  ) {}

  private get admin(): DbClient {
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
    const { data, error } = await this.admin
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
    const { data, error } = await this.session
      .from(table)
      .select(idColumn)
      .eq("work_order_id", workOrderId)
      .eq(idColumn, triggerEntityId)
      .maybeSingle();
    throwQuery(error);
    return Boolean(data);
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
    const { data: userMessage, error: userError } = await this.admin
      .from("ai_assistant_message")
      .insert({
        thread_id: input.threadId,
        role: "user",
        body: input.text,
        generation_status: "ready",
        created_by_user_id: input.userId,
      })
      .select("ai_assistant_message_id")
      .single();
    throwQuery(userError);
    if (!userMessage) throw new Error("ASK_OTOMOTO_TURN_CREATE_FAILED");
    const userMessageId = String(userMessage.ai_assistant_message_id);
    if (input.photos.length > 0) {
      const { error } = await this.admin.from("ai_assistant_message_photo").insert(
        input.photos.map((photo) => ({
          message_id: userMessageId,
          photo_id: photo.photoId,
          purpose: photo.purpose,
          sort_order: photo.sortOrder,
        }))
      );
      throwQuery(error);
    }
    const { data: assistantMessage, error: assistantError } = await this.admin
      .from("ai_assistant_message")
      .insert({
        thread_id: input.threadId,
        role: "assistant",
        generation_status: "generating",
      })
      .select("ai_assistant_message_id")
      .single();
    throwQuery(assistantError);
    if (!assistantMessage) throw new Error("ASK_OTOMOTO_TURN_CREATE_FAILED");
    const { error: threadError } = await this.admin
      .from("ai_assistant_thread")
      .update({ status: "generating", updated_at: new Date().toISOString() })
      .eq("ai_assistant_thread_id", input.threadId);
    throwQuery(threadError);
    return {
      userMessageId,
      assistantMessageId: String(assistantMessage.ai_assistant_message_id),
    };
  }

  async loadGenerationInput(
    workOrderId: string,
    threadId: string,
    assistantMessageId: string
  ): Promise<GenerationInput> {
    const workspace = await this.loadThread(workOrderId, threadId);
    if (!workspace) throw new Error("ASK_OTOMOTO_THREAD_NOT_FOUND");
    const assistantIndex = workspace.messages.findIndex(
      (message) => message.messageId === assistantMessageId
    );
    if (assistantIndex < 1) throw new Error("ASK_OTOMOTO_TURN_NOT_FOUND");
    const user = workspace.messages[assistantIndex - 1];
    if (!user || user.role !== "user" || !user.body) {
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
      history: workspace.messages
        .slice(0, assistantIndex - 1)
        .filter(
          (
            message
          ): message is DiagnosticsMessageView & {
            role: "user" | "assistant";
            body: string;
          } =>
            (message.role === "user" || message.role === "assistant") &&
            message.generationStatus === "ready" &&
            Boolean(message.body)
        )
        .map((message) => ({ role: message.role, content: message.body })),
    };
  }

  async completeGeneration(input: CompleteGenerationInput): Promise<void> {
    const { error: messageError } = await this.admin
      .from("ai_assistant_message")
      .update({
        body: input.body,
        generation_status: "ready",
        requested_input: input.requestedInput,
        phase: input.phase,
        provider_model: input.response.resolvedModel,
        provider_response_id: input.response.responseId,
        prompt_version: input.response.promptVersion,
        input_token_count: input.response.usage.inputTokens,
        output_token_count: input.response.usage.outputTokens,
        context_as_of: input.contextAsOf,
        context_hash: input.response.contextHash,
        safe_error_code: null,
        updated_at: input.contextAsOf,
      })
      .eq("thread_id", input.threadId)
      .eq("ai_assistant_message_id", input.assistantMessageId);
    throwQuery(messageError);
    const { error: threadError } = await this.admin
      .from("ai_assistant_thread")
      .update({
        status: "ready",
        diagnostic_phase: input.phase,
        updated_at: input.contextAsOf,
      })
      .eq("ai_assistant_thread_id", input.threadId);
    throwQuery(threadError);
  }

  async failGeneration(input: {
    threadId: string;
    assistantMessageId: string;
    safeErrorCode: string;
  }): Promise<void> {
    const now = new Date().toISOString();
    const { error: messageError } = await this.admin
      .from("ai_assistant_message")
      .update({
        body: null,
        generation_status: "failed",
        safe_error_code: input.safeErrorCode,
        updated_at: now,
      })
      .eq("thread_id", input.threadId)
      .eq("ai_assistant_message_id", input.assistantMessageId);
    throwQuery(messageError);
    const { error: threadError } = await this.admin
      .from("ai_assistant_thread")
      .update({ status: "failed", updated_at: now })
      .eq("ai_assistant_thread_id", input.threadId);
    throwQuery(threadError);
  }

  async loadLatestFailedTurn(
    workOrderId: string,
    threadId: string
  ): Promise<FailedTurn | null> {
    const workspace = await this.loadThread(workOrderId, threadId);
    if (!workspace) return null;
    const failed = [...workspace.messages]
      .reverse()
      .find(
        (message) => message.role === "assistant" && message.generationStatus === "failed"
      );
    if (!failed) return null;
    const loaded = await this.loadGenerationInput(
      workOrderId,
      threadId,
      failed.messageId
    );
    const { data: claimed, error } = await this.admin
      .from("ai_assistant_message")
      .update({
        generation_status: "generating",
        safe_error_code: null,
        updated_at: new Date().toISOString(),
      })
      .eq("thread_id", threadId)
      .eq("ai_assistant_message_id", failed.messageId)
      .eq("generation_status", "failed")
      .select("ai_assistant_message_id")
      .maybeSingle();
    throwQuery(error);
    if (!claimed) return null;
    await this.admin
      .from("ai_assistant_thread")
      .update({ status: "generating", updated_at: new Date().toISOString() })
      .eq("ai_assistant_thread_id", threadId);
    return {
      ...loaded,
      mode: workspace.thread.mode,
      jobId: workspace.thread.jobId,
    };
  }

  async loadContextSource(
    workOrderId: string,
    jobId: string | null,
    includeFrontOffice: boolean
  ): Promise<LoadedContext> {
    const { data: workOrder, error: workOrderError } = await this.admin
      .from("work_order")
      .select(
        "work_order_id, work_order_number, status, lifecycle_state, mileage, internal_notes, motorcycle_id"
      )
      .eq("work_order_id", workOrderId)
      .single();
    throwQuery(workOrderError);
    if (!workOrder) throw new Error("WORK_ORDER_NOT_FOUND");
    const { data: motorcycle, error: motorcycleError } = await this.admin
      .from("motorcycle")
      .select(
        "motorcycle_id, customer_id, year, make, model, colour, odometer_unit, vin, notes"
      )
      .eq("motorcycle_id", workOrder.motorcycle_id)
      .single();
    throwQuery(motorcycleError);
    if (!motorcycle) throw new Error("MOTORCYCLE_NOT_FOUND");
    const { data: customer, error: customerError } = await this.admin
      .from("customer")
      .select("first_name, last_name, email, phone, address")
      .eq("customer_id", motorcycle.customer_id)
      .single();
    throwQuery(customerError);
    if (!customer) throw new Error("CUSTOMER_NOT_FOUND");

    let jobsQuery = this.admin
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
      this.admin
        .from("motorcycle_service_information")
        .select(
          "oil_filter, oil_type, oil_capacity, air_filter, spark_plugs, front_brake_pads, rear_brake_pads, front_tire_size, rear_tire_size, chain, battery, notes"
        )
        .eq("motorcycle_id", motorcycle.motorcycle_id)
        .maybeSingle(),
      this.admin
        .from("inspection")
        .select(
          "inspection_id, work_order_id, completed_at, results:inspection_result(inspection_result_id, category_snapshot, item_name_snapshot, display_order_snapshot, status, measurement, notes)"
        )
        .eq("work_order_id", workOrderId)
        .maybeSingle(),
      this.admin
        .from("technician_note")
        .select("technician_note_id, work_order_id, job_id, note_type, note, created_at")
        .eq("work_order_id", workOrderId),
      this.admin
        .from("recommendation")
        .select(
          "recommendation_id, work_order_id, description, severity, status, disposition, notes, converted_job_id"
        )
        .eq("work_order_id", workOrderId),
      this.admin
        .from("quality_check_attempt")
        .select("attempt_id, work_order_id, outcome, checklist, notes, performed_at")
        .eq("work_order_id", workOrderId),
      this.admin
        .from("safety_check_attempt")
        .select("attempt_id, work_order_id, outcome, checklist, notes, performed_at")
        .eq("work_order_id", workOrderId),
      jobIds.length
        ? this.admin
            .from("job_checklist_item")
            .select("job_checklist_item_id, job_id, title, checked_at")
            .in("job_id", jobIds)
        : Promise.resolve({ data: [], error: null }),
      jobIds.length
        ? this.admin
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
        ? this.admin
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
            verification: [],
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
        fullVin: motorcycle.vin ? String(motorcycle.vin) : null,
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
    const { data: estimate, error } = await this.admin
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
      this.admin
        .from("estimate_job")
        .select(
          "job_id, labor_cents, parts_cents, fees_cents, discount_cents, tax_cents, total_cents"
        )
        .eq("estimate_version_id", estimate.current_version_id)
        .in("job_id", jobIds),
      this.admin
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
    const { data, error } = await this.admin
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
    const { data, error } = await this.admin.storage
      .from("intake-photos")
      .download(storagePath);
    throwQuery(error);
    if (!data || data.size > options.maxBytes) {
      throw new Error("DIAGNOSTICS_IMAGE_TOO_LARGE");
    }
    return new Uint8Array(await data.arrayBuffer());
  }

  async recordModelChangeAudit(input: {
    actorUserId: string;
    locationId: string;
    messageId: string;
    previousModel: string;
    resolvedModel: string;
  }): Promise<void> {
    await addAuditLog(this.admin, {
      actor_user_id: input.actorUserId,
      location_id: input.locationId,
      action: "ask_otomoto_model_alias_changed",
      entity_type: "ai_assistant_message",
      entity_id: input.messageId,
      description: "Ask OTOMOTO resolved model changed",
      old_value: { resolved_model: input.previousModel },
      new_value: { resolved_model: input.resolvedModel },
    });
  }
}

async function defaultRepository(): Promise<DiagnosticsAssistantRepository> {
  return new SupabaseDiagnosticsRepository(
    await createClient(),
    createDiagnosticsAdminClient
  );
}

function safeFailureCode(error: unknown): string {
  const value = error instanceof Error ? error.message : "";
  return /^[A-Z][A-Z0-9_]*$/.test(value)
    ? value.slice(0, 120)
    : "DIAGNOSTICS_AI_PROVIDER_FAILED";
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

export function createDiagnosticsAssistantService(
  dependencies: DiagnosticsAssistantDependencies = {}
) {
  const authenticate = dependencies.requireUser ?? requireSessionUser;
  const now = dependencies.now ?? (() => new Date());
  const generate = dependencies.generateDraft ?? generateDiagnosticsDraft;
  const prepare = dependencies.prepareImages ?? defaultPrepareImages;
  const consumeRateLimit = dependencies.consumeRateLimit ?? defaultRateLimit;
  const repo = async () => dependencies.repository ?? (await defaultRepository());

  async function generateTurn(input: {
    actor: AppUser;
    repository: DiagnosticsAssistantRepository;
    scope: DiagnosticsWorkOrderScope;
    thread: DiagnosticsThreadSummary;
    generation: GenerationInput;
  }): Promise<DiagnosticsMessageView> {
    const contextAsOf = now().toISOString();
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
      const prepared = await prepare(
        {
          workOrderId: input.thread.workOrderId,
          jobId: input.thread.jobId,
          selections: input.generation.photos,
          redactTerms: loaded.redactTerms,
        },
        input.repository
      );
      const response = await generate({
        mode: input.thread.mode,
        staffUserId: input.actor.user_id,
        workOrderContext: shaped.context,
        userMessage: input.generation.userMessage,
        history: input.generation.history,
        images: prepared.images,
      });
      const priorReady = (
        await input.repository.loadThread(input.thread.workOrderId, input.thread.threadId)
      )?.messages
        .filter(
          (message) =>
            message.messageId !== input.generation.assistantMessageId &&
            message.role === "assistant" &&
            message.generationStatus === "ready" &&
            Boolean(message.providerModel)
        )
        .at(-1);
      await input.repository.completeGeneration({
        threadId: input.thread.threadId,
        assistantMessageId: input.generation.assistantMessageId,
        body: renderDiagnosticsDraft(response.response),
        response,
        contextAsOf,
        phase: response.response.phase,
        requestedInput: response.response.requested_input,
      });
      if (
        priorReady?.providerModel &&
        priorReady.providerModel !== response.resolvedModel
      ) {
        await input.repository.recordModelChangeAudit?.({
          actorUserId: input.actor.user_id,
          locationId: input.scope.locationId,
          messageId: input.generation.assistantMessageId,
          previousModel: priorReady.providerModel,
          resolvedModel: response.resolvedModel,
        });
      }
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
    } catch (error) {
      await input.repository.failGeneration({
        threadId: input.thread.threadId,
        assistantMessageId: input.generation.assistantMessageId,
        safeErrorCode: safeFailureCode(error),
      });
      throw error;
    }
  }

  return {
    async listThreads(workOrderId: string): Promise<DiagnosticsThreadSummary[]> {
      const user = await authenticate();
      const repository = await repo();
      const scope = await repository.loadWorkOrderScope(uuidSchema.parse(workOrderId));
      if (!scope) throw new Error("WORK_ORDER_NOT_FOUND");
      const rows = await repository.listThreads(workOrderId);
      return rows.filter((thread) => {
        try {
          assertDiagnosticsAccess(user, scope, thread.mode, "read");
          return true;
        } catch {
          return false;
        }
      });
    },

    async loadThread(
      workOrderId: string,
      threadId: string
    ): Promise<DiagnosticsThreadWorkspace> {
      const user = await authenticate();
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
      return workspace;
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
      const workspace = await assertThread(repository, input.workOrderId, input.threadId);
      if (
        workspace.thread.mode !== input.mode ||
        workspace.thread.jobId !== (input.jobId ?? null) ||
        workspace.thread.audience !== deriveDiagnosticsAudience(input.mode)
      ) {
        throw new Error("ASK_OTOMOTO_THREAD_SCOPE_MISMATCH");
      }
      const workOrder = await requireScope(
        repository,
        user,
        input.workOrderId,
        input.mode,
        "write"
      );
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
      const turn = await repository.beginTurn({
        threadId: input.threadId,
        userId: user.user_id,
        text: input.text,
        photos: input.photos.map((photo, sortOrder) => ({
          ...photo,
          sortOrder,
        })),
      });
      const generation = await repository.loadGenerationInput(
        input.workOrderId,
        input.threadId,
        turn.assistantMessageId
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
      const workspace = await assertThread(repository, input.workOrderId, input.threadId);
      const workOrder = await requireScope(
        repository,
        user,
        input.workOrderId,
        workspace.thread.mode,
        "write"
      );
      if (!consumeRateLimit(user.user_id).success) throw new Error("RATE_LIMITED");
      const failed = await repository.loadLatestFailedTurn(
        input.workOrderId,
        input.threadId
      );
      if (!failed) throw new Error("ASK_OTOMOTO_RETRY_NOT_FOUND");
      return generateTurn({
        actor: user,
        repository,
        scope: workOrder,
        thread: workspace.thread,
        generation: failed,
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
  await assertJob(repository, input.workOrderId, input.jobId ?? null);
  const triggerType: AiAssistantTriggerType =
    input.trigger === "inspection_completion" ? "inspection_completed" : "job_completed";
  if (input.trigger === "job_completion" && input.jobId !== input.triggerEntityId) {
    throw new Error("ASK_OTOMOTO_TRIGGER_NOT_FOUND");
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
  if (existing) return existing;
  try {
    return await repository.createThread({
      workOrderId: input.workOrderId,
      jobId: input.jobId ?? null,
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
    if (code !== "23505") throw error;
    const recovered = await repository.findTriggerThread(
      input.workOrderId,
      triggerType,
      input.triggerEntityId
    );
    if (!recovered) throw error;
    return recovered;
  }
}
