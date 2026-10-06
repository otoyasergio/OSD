import type { QueuedPhotoUpload } from "./types";

export type PreparedPhotoUploadInput = {
  file: File;
  userId: string;
  locationId: string;
  category: string;
  workOrderId?: string;
  intakeDraftId?: string;
  jobId?: string;
  inspectionResultId?: string;
  assistantThreadId?: string;
  notes?: string;
  queueId?: string;
  clientUploadId?: string;
  now: number;
};

export type PreparedPhotoBytesInput = Omit<PreparedPhotoUploadInput, "file"> & {
  bytes: ArrayBuffer | Uint8Array;
  fileName: string;
  mimeType?: string;
  lastModified?: number;
};

export async function prepareQueuedPhoto(
  input: PreparedPhotoUploadInput
): Promise<QueuedPhotoUpload> {
  const bytes = await input.file.arrayBuffer();
  return prepareQueuedPhotoFromBytes({
    ...input,
    bytes,
    fileName: input.file.name,
    mimeType: input.file.type || "image/jpeg",
    lastModified: input.file.lastModified,
  });
}

export function prepareQueuedPhotoFromBytes(
  input: PreparedPhotoBytesInput
): QueuedPhotoUpload {
  const queueId = input.queueId ?? crypto.randomUUID();
  const clientUploadId = input.clientUploadId ?? crypto.randomUUID();
  const source =
    input.bytes instanceof Uint8Array ? input.bytes : new Uint8Array(input.bytes);
  const copy = Uint8Array.from(source);
  const mimeType = input.mimeType || "image/jpeg";
  const blob = new Blob([copy.buffer], { type: mimeType });
  const base = {
    queueId,
    clientUploadId,
    userId: input.userId,
    locationId: input.locationId,
    category: input.category,
    blob,
    fileName: input.fileName,
    mimeType,
    lastModified: input.lastModified || Date.now(),
    byteCount: copy.byteLength,
    status: "preparing" as const,
    attemptCount: 0,
    retryAt: null,
    lastError: null,
    createdAt: input.now,
    updatedAt: input.now,
    leaseOwner: null,
    leaseExpiresAt: null,
    uploadSlotOwner: null,
    uploadSlotExpiresAt: null,
    ...(input.jobId ? { jobId: input.jobId } : {}),
    ...(input.inspectionResultId ? { inspectionResultId: input.inspectionResultId } : {}),
    ...(input.assistantThreadId ? { assistantThreadId: input.assistantThreadId } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
  };
  if (input.workOrderId) {
    return { ...base, workOrderId: input.workOrderId };
  }
  if (!input.intakeDraftId) {
    throw new Error("A photo upload needs a work order or an intake draft.");
  }
  return { ...base, intakeDraftId: input.intakeDraftId };
}

export function fileFromQueuedPhoto(item: QueuedPhotoUpload): File {
  return new File([item.blob], item.fileName, {
    type: item.mimeType,
    lastModified: item.lastModified,
  });
}

export function newestIncompleteIntakeDraft(
  items: QueuedPhotoUpload[]
): { intakeDraftId: string; items: QueuedPhotoUpload[] } | null {
  const drafts = items.filter(
    (item): item is QueuedPhotoUpload & { intakeDraftId: string } =>
      Boolean(item.intakeDraftId) && !item.workOrderId
  );
  if (drafts.length === 0) return null;
  const newest = drafts.reduce((latest, item) => {
    if (item.createdAt > latest.createdAt) return item;
    if (item.createdAt < latest.createdAt) return latest;
    if (item.updatedAt > latest.updatedAt) return item;
    if (item.updatedAt < latest.updatedAt) return latest;
    return item;
  });
  const intakeDraftId = newest.intakeDraftId;
  return {
    intakeDraftId,
    items: drafts
      .filter((item) => item.intakeDraftId === intakeDraftId)
      .sort((left, right) => left.createdAt - right.createdAt),
  };
}

export function photoUploadQueueCounts(items: QueuedPhotoUpload[]): {
  waiting: number;
  uploading: number;
  failed: number;
} {
  return items.reduce(
    (counts, item) => {
      if (item.status === "failed") counts.failed += 1;
      else if (item.status === "uploading") counts.uploading += 1;
      else if (item.status !== "saved") counts.waiting += 1;
      return counts;
    },
    { waiting: 0, uploading: 0, failed: 0 }
  );
}
