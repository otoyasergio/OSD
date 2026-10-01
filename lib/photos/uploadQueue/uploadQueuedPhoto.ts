import { compressImageForUpload } from "@/lib/forms/compressImageForUpload";
import { isRetryablePhotoUploadFailure } from "@/lib/forms/photoUploadErrors";
import type { PhotoUploadOutcome, QueuedPhotoUpload } from "./types";

export type IntakePhotoActionState = {
  error: string | null;
  photoId?: string;
  clientUploadId?: string;
};

export type AssistantPhotoActionState = {
  status: "idle" | "success" | "error";
  error: string | null;
  data?: unknown;
};

export type QueuedPhotoUploadActions = {
  uploadIntakePhoto(
    workOrderId: string,
    previous: IntakePhotoActionState,
    formData: FormData
  ): Promise<IntakePhotoActionState>;
  uploadAssistantPhoto(
    workOrderId: string,
    previous: AssistantPhotoActionState,
    formData: FormData
  ): Promise<AssistantPhotoActionState>;
};

const CONFIRMATION_MISMATCH = "The server confirmation did not match this photo upload.";

function fileFromQueuedPhoto(item: QueuedPhotoUpload): File {
  return new File([item.blob], item.fileName, {
    type: item.mimeType,
    lastModified: item.lastModified,
  });
}

function failure(message: string): PhotoUploadOutcome {
  return {
    ok: false,
    retryable: isRetryablePhotoUploadFailure(message),
    message,
  };
}

function confirmation(
  photoId: string | undefined,
  clientUploadId: string | undefined,
  expected: string
): PhotoUploadOutcome {
  if (!photoId || clientUploadId !== expected) {
    return { ok: false, retryable: false, message: CONFIRMATION_MISMATCH };
  }
  return { ok: true, photoId };
}

export async function uploadQueuedPhoto(
  item: QueuedPhotoUpload,
  _signal: AbortSignal,
  actions: QueuedPhotoUploadActions
): Promise<PhotoUploadOutcome> {
  if (!item.workOrderId) {
    return failure("This photo is not attached to a work order yet.");
  }

  const file = await compressImageForUpload(fileFromQueuedPhoto(item));
  const form = new FormData();
  form.set("file", file);
  form.set("client_upload_id", item.clientUploadId);

  if (item.assistantThreadId) {
    form.set("thread_id", item.assistantThreadId);
    form.set("purpose", item.notes ?? "Work photo for analysis");
    const result = await actions.uploadAssistantPhoto(
      item.workOrderId,
      { status: "idle", error: null },
      form
    );
    if (result.status !== "success") {
      return failure(result.error ?? "Could not upload the photo. Try again.");
    }
    const data =
      result.data && typeof result.data === "object"
        ? (result.data as { photoId?: string; clientUploadId?: string })
        : {};
    return confirmation(data.photoId, data.clientUploadId, item.clientUploadId);
  }

  form.set("category", item.category);
  if (item.notes) form.set("notes", item.notes);
  if (item.jobId) form.set("job_id", item.jobId);
  if (item.inspectionResultId) form.set("inspection_result_id", item.inspectionResultId);

  const result = await actions.uploadIntakePhoto(item.workOrderId, { error: null }, form);
  if (result.error && !result.photoId) {
    return failure(result.error);
  }
  return confirmation(result.photoId, result.clientUploadId, item.clientUploadId);
}
