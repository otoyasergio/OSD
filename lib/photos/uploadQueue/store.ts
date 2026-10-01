import type { PhotoUploadQueuePatch, PhotoUploadScope, QueuedPhotoUpload } from "./types";

export const DEFAULT_PHOTO_UPLOAD_MAX_ATTEMPTS = 5;
export const PHOTO_UPLOAD_MAX_ATTEMPTS_ERROR =
  "This photo reached the maximum upload attempts. Retry it manually.";

export class PhotoUploadQueueScopeError extends Error {
  readonly name = "PhotoUploadQueueScopeError";

  constructor() {
    super("Photo upload does not belong to the provided scope.");
  }
}

export type PhotoUploadClaim = {
  expiresAt: number;
};

export type PhotoUploadEligibilitySnapshot = Pick<
  QueuedPhotoUpload,
  "status" | "attemptCount" | "retryAt" | "lastError"
>;

export type AcquiredPhotoUploadClaim = PhotoUploadClaim & {
  item: QueuedPhotoUpload;
  priorEligibility: PhotoUploadEligibilitySnapshot;
};

export type PhotoUploadFailureSettlement = {
  status: "retry_wait" | "failed";
  retryAt: number | null;
  lastError: string;
  updatedAt: number;
};

export interface PhotoUploadQueueStore {
  put(scope: PhotoUploadScope, item: QueuedPhotoUpload): Promise<void>;
  get(queueId: string, scope: PhotoUploadScope): Promise<QueuedPhotoUpload | null>;
  list(scope: PhotoUploadScope): Promise<QueuedPhotoUpload[]>;
  update(
    queueId: string,
    scope: PhotoUploadScope,
    patch: PhotoUploadQueuePatch
  ): Promise<QueuedPhotoUpload | null>;
  remove(queueId: string, scope: PhotoUploadScope): Promise<void>;
  recoverInterrupted(
    scope: PhotoUploadScope,
    now: number,
    maxAttempts?: number
  ): Promise<number>;
  tryAcquireLease(
    queueId: string,
    scope: PhotoUploadScope,
    owner: string,
    now: number,
    ttlMs: number
  ): Promise<boolean>;
  tryAcquireUploadClaim(
    queueId: string,
    scope: PhotoUploadScope,
    owner: string,
    now: number,
    ttlMs: number,
    maxScopeSlots: number,
    maxAttempts: number
  ): Promise<AcquiredPhotoUploadClaim | null>;
  renewUploadClaim(
    queueId: string,
    scope: PhotoUploadScope,
    owner: string,
    now: number,
    ttlMs: number
  ): Promise<PhotoUploadClaim | null>;
  releaseUnstartedUploadClaim(
    queueId: string,
    scope: PhotoUploadScope,
    owner: string,
    now: number,
    claim: AcquiredPhotoUploadClaim
  ): Promise<boolean>;
  updateClaimed(
    queueId: string,
    scope: PhotoUploadScope,
    owner: string,
    now: number,
    patch: PhotoUploadQueuePatch,
    releaseClaim?: boolean
  ): Promise<QueuedPhotoUpload | null>;
  settleClaimedFailure(
    queueId: string,
    scope: PhotoUploadScope,
    owner: string,
    now: number,
    settlement: PhotoUploadFailureSettlement
  ): Promise<QueuedPhotoUpload | null>;
  completeClaimedUpload(
    queueId: string,
    scope: PhotoUploadScope,
    owner: string,
    now: number
  ): Promise<boolean>;
  releaseUploadClaim(
    queueId: string,
    scope: PhotoUploadScope,
    owner: string,
    now: number,
    maxAttempts?: number
  ): Promise<boolean>;
}
