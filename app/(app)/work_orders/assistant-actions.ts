"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getRolePreviewContext } from "@/lib/auth/role-preview";
import {
  createDiagnosticsAssistantService,
  createDiagnosticsThreadSchema,
  retryDiagnosticsTurnSchema,
  submitDiagnosticsTurnSchema,
} from "@/lib/services/diagnosticsAssistant";
import { promoteReviewedTechnicianNote } from "@/lib/services/notes";
import { uploadIntakePhoto } from "@/lib/services/photos";
import { toFormErrorMessage } from "@/lib/services/errors";
import { diagnosticsErrorMessageForCode } from "@/lib/diagnostics/errors";
import { redactDiagnosticsText } from "@/lib/diagnostics/redaction";
import {
  DIAGNOSTICS_PHOTO_PURPOSE_MAX,
  collapseWhitespace,
} from "@/lib/diagnostics/photoSelection";

export type AssistantActionState = {
  status: "idle" | "success" | "error";
  error: string | null;
  data?: unknown;
};

const service = createDiagnosticsAssistantService();
const uuid = z.string().uuid();
const promoteSchema = z
  .object({
    sourceMessageId: uuid,
    jobId: uuid.nullable(),
    noteType: z.enum([
      "general",
      "diagnostic_finding",
      "customer_concern_confirmed",
      "customer_concern_not_found",
      "parts_issue",
      "internal_warning",
    ]),
    text: z.string().trim().min(1).max(8_000),
  })
  .strict();

/**
 * Photo purpose stored as notes: whitespace-normalized first (assistant prompts
 * can contain newlines/tabs), then required, bounded, control-char free, and
 * PII-redacted.
 */
function parseUploadPurpose(value: FormDataEntryValue | null): string {
  const purpose = typeof value === "string" ? collapseWhitespace(value) : "";
  if (
    !purpose ||
    purpose.length > DIAGNOSTICS_PHOTO_PURPOSE_MAX ||
    /[\u0000-\u001f\u007f]/.test(purpose)
  ) {
    throw new Error("DIAGNOSTICS_IMAGE_PURPOSE_INVALID");
  }
  const redacted = redactDiagnosticsText(purpose).trim();
  if (!redacted) throw new Error("DIAGNOSTICS_IMAGE_PURPOSE_INVALID");
  return redacted.slice(0, DIAGNOSTICS_PHOTO_PURPOSE_MAX);
}

function success(data?: unknown): AssistantActionState {
  return { status: "success", error: null, ...(data === undefined ? {} : { data }) };
}

function isSafeActionCode(value: string): boolean {
  return /^(?:(?:ASK_OTOMOTO|DIAGNOSTICS|WORK_ORDER|JOB|PHOTO)_[A-Z0-9_]+|RATE_LIMITED|FOREIGN_LOCATION|FORBIDDEN|UNAUTHORIZED|ROLE_PREVIEW_MUTATION_BLOCKED)$/.test(
    value
  );
}

function failure(error: unknown): AssistantActionState {
  const zodCode =
    error instanceof z.ZodError
      ? error.issues.find((issue) => isSafeActionCode(issue.message))?.message
      : null;
  const rawCode =
    error instanceof Error && isSafeActionCode(error.message) ? error.message : zodCode;
  const code = rawCode ?? "ASK_OTOMOTO_REQUEST_FAILED";
  return {
    status: "error",
    error: diagnosticsErrorMessageForCode(code) ?? toFormErrorMessage(new Error(code)),
  };
}

async function assertMutationNotPreviewed(): Promise<void> {
  const preview = await getRolePreviewContext();
  if (!preview) throw new Error("UNAUTHORIZED");
  if (preview.isPreviewing) throw new Error("ROLE_PREVIEW_MUTATION_BLOCKED");
}

function revalidateAssistant(workOrderId: string): void {
  revalidatePath(`/work_orders/${workOrderId}`);
  revalidatePath("/work_orders");
  revalidatePath("/dashboard");
  revalidatePath("/technician");
  revalidatePath("/technician/docket");
}

export async function createAssistantThreadAction(
  workOrderId: string,
  _previous: AssistantActionState,
  formData: FormData
): Promise<AssistantActionState> {
  try {
    await assertMutationNotPreviewed();
    const rawJobId = String(formData.get("job_id") ?? "").trim();
    const input = createDiagnosticsThreadSchema.parse({
      workOrderId,
      jobId: rawJobId || null,
      mode: String(formData.get("mode") ?? ""),
    });
    const thread = await service.createThread(input);
    revalidateAssistant(workOrderId);
    return success(thread);
  } catch (error) {
    return failure(error);
  }
}

export async function submitAssistantTurnAction(
  workOrderId: string,
  _previous: AssistantActionState,
  formData: FormData
): Promise<AssistantActionState> {
  try {
    await assertMutationNotPreviewed();
    const rawPhotos = String(formData.get("photos") ?? "[]");
    let photos: unknown;
    try {
      photos = JSON.parse(rawPhotos);
    } catch {
      throw new Error("DIAGNOSTICS_IMAGE_SELECTION_INVALID");
    }
    const rawJobId = String(formData.get("job_id") ?? "").trim();
    const input = submitDiagnosticsTurnSchema.parse({
      workOrderId,
      threadId: String(formData.get("thread_id") ?? ""),
      jobId: rawJobId || null,
      mode: String(formData.get("mode") ?? ""),
      text: String(formData.get("text") ?? ""),
      photos,
    });
    const message = await service.submitTurn(input);
    revalidateAssistant(workOrderId);
    return success(message);
  } catch (error) {
    return failure(error);
  }
}

export async function retryAssistantTurnAction(
  workOrderId: string,
  _previous: AssistantActionState,
  formData: FormData
): Promise<AssistantActionState> {
  try {
    await assertMutationNotPreviewed();
    const input = retryDiagnosticsTurnSchema.parse({
      workOrderId,
      threadId: String(formData.get("thread_id") ?? ""),
    });
    const message = await service.retryLatestFailed(input);
    revalidateAssistant(workOrderId);
    return success(message);
  } catch (error) {
    return failure(error);
  }
}

export async function promoteAssistantNoteAction(
  workOrderId: string,
  _previous: AssistantActionState,
  formData: FormData
): Promise<AssistantActionState> {
  try {
    await assertMutationNotPreviewed();
    const rawJobId = String(formData.get("job_id") ?? "").trim();
    const input = promoteSchema.parse({
      sourceMessageId: String(formData.get("source_message_id") ?? ""),
      jobId: rawJobId || null,
      noteType: String(formData.get("note_type") ?? ""),
      text: String(formData.get("text") ?? ""),
    });
    const note = await promoteReviewedTechnicianNote(workOrderId, input);
    revalidateAssistant(workOrderId);
    return success(note);
  } catch (error) {
    return failure(error);
  }
}

export async function uploadAssistantPhotoAction(
  workOrderId: string,
  _previous: AssistantActionState,
  formData: FormData
): Promise<AssistantActionState> {
  try {
    await assertMutationNotPreviewed();
    const parsedWorkOrderId = uuid.parse(workOrderId);
    const threadId = uuid.parse(String(formData.get("thread_id") ?? ""));
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new Error("PHOTO_REQUIRED");
    }
    const workspace = await service.authorizeThreadWrite(parsedWorkOrderId, threadId);
    if (!workspace.thread.jobId) throw new Error("DIAGNOSTICS_IMAGE_JOB_REQUIRED");
    const purpose = parseUploadPurpose(formData.get("purpose"));
    const photo = await uploadIntakePhoto(parsedWorkOrderId, {
      category: "job_work",
      job_id: workspace.thread.jobId,
      notes: purpose,
      inspection_result_id: null,
      file,
    });
    revalidateAssistant(workOrderId);
    return success({
      photoId: photo.photo_id,
      workOrderId: photo.work_order_id,
      jobId: photo.job_id,
      category: photo.category,
      notes: photo.notes,
      createdAt: photo.created_at,
    });
  } catch (error) {
    return failure(error);
  }
}
