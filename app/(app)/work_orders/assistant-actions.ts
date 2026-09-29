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
      "road_test",
      "quality_check",
      "internal_warning",
      "proof_exception",
    ]),
    text: z.string().trim().min(1).max(8_000),
  })
  .strict();

function success(data?: unknown): AssistantActionState {
  return { status: "success", error: null, ...(data === undefined ? {} : { data }) };
}

function failure(error: unknown): AssistantActionState {
  return { status: "error", error: toFormErrorMessage(error) };
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

export async function listAssistantThreadsAction(
  workOrderId: string
): Promise<AssistantActionState> {
  try {
    return success(await service.listThreads(uuid.parse(workOrderId)));
  } catch (error) {
    return failure(error);
  }
}

export async function loadAssistantThreadAction(
  workOrderId: string,
  threadId: string
): Promise<AssistantActionState> {
  try {
    return success(
      await service.loadThread(uuid.parse(workOrderId), uuid.parse(threadId))
    );
  } catch (error) {
    return failure(error);
  }
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
    const workspace = await service.loadThread(parsedWorkOrderId, threadId);
    if (!workspace.thread.jobId) throw new Error("JOB_NOT_FOUND");
    const photo = await uploadIntakePhoto(parsedWorkOrderId, {
      category: "job_work",
      job_id: workspace.thread.jobId,
      notes: String(formData.get("purpose") ?? "").trim() || null,
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
