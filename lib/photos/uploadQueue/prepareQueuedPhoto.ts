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

export async function prepareQueuedPhoto(
  input: PreparedPhotoUploadInput
): Promise<QueuedPhotoUpload> {
  const queueId = input.queueId ?? crypto.randomUUID();
  const clientUploadId = input.clientUploadId ?? crypto.randomUUID();
  const bytes = await input.file.arrayBuffer();
  const blob = new Blob([bytes], { type: input.file.type || "image/jpeg" });
  const base = {
    queueId,
    clientUploadId,
    userId: input.userId,
    locationId: input.locationId,
    category: input.category,
    blob,
    fileName: input.file.name,
    mimeType: input.file.type || "image/jpeg",
    lastModified: input.file.lastModified,
    byteCount: input.file.size,
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
