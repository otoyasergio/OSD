export type PhotoUploadScope = {
  userId: string;
  locationId: string;
};

export type PhotoUploadStatus =
  "preparing" | "queued" | "uploading" | "retry_wait" | "saved" | "failed";

type WorkOrderUploadTarget = {
  workOrderId: string;
  intakeDraftId?: never;
};

type IntakeDraftUploadTarget = {
  workOrderId?: never;
  intakeDraftId: string;
};

type QueuedPhotoUploadFields = {
  queueId: string;
  clientUploadId: string;
  userId: string;
  locationId: string;
  category: string;
  jobId?: string;
  inspectionResultId?: string;
  notes?: string;
  blob: Blob;
  fileName: string;
  mimeType: string;
  lastModified: number;
  pixelWidth?: number;
  pixelHeight?: number;
  byteCount: number;
  status: PhotoUploadStatus;
  /**
   * Number of uploader failures durably settled in IndexedDB. Claiming or
   * starting an upload does not increment this count; interrupted work is
   * replayed and therefore requires Task 2 server idempotency by clientUploadId.
   */
  attemptCount: number;
  retryAt: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
  leaseOwner: string | null;
  leaseExpiresAt: number | null;
  uploadSlotOwner: string | null;
  uploadSlotExpiresAt: number | null;
};

export type QueuedPhotoUpload = QueuedPhotoUploadFields &
  (WorkOrderUploadTarget | IntakeDraftUploadTarget);

export type PhotoUploadQueuePatch = Partial<
  Pick<
    QueuedPhotoUploadFields,
    "status" | "attemptCount" | "retryAt" | "lastError" | "updatedAt"
  >
>;

export type PhotoUploadOutcome =
  { ok: true; photoId: string } | { ok: false; retryable: boolean; message: string };
