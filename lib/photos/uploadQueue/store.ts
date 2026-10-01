import { assertPhotoUploadTransition } from "./stateTransitions";
import type {
  PhotoUploadOutcome,
  PhotoUploadQueuePatch,
  PhotoUploadScope,
  QueuedPhotoUpload,
} from "./types";

/** Maximum persisted failed uploader outcomes before an item becomes terminal. */
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
  "status" | "retryAt" | "lastError"
>;

export type AcquiredPhotoUploadClaim = PhotoUploadClaim & {
  item: QueuedPhotoUpload;
  priorEligibility: PhotoUploadEligibilitySnapshot;
};

export type PhotoUploadFailureOutcome = Extract<PhotoUploadOutcome, { ok: false }>;

export type PhotoUploadRetryPolicy = {
  maxAttempts: number;
  baseRetryDelayMs: number;
  maxRetryDelayMs: number;
};

export type PhotoUploadFailureSettlement = {
  status: "retry_wait" | "failed";
  attemptCount: number;
  retryAt: number | null;
  lastError: string;
  updatedAt: number;
};

/**
 * Creates the state persisted for one observed uploader failure.
 *
 * Claims and uploader starts do not count as attempts. Interrupted uploads are
 * replayed at least once, so the Task 2 server uploader must use clientUploadId
 * idempotently before this queue is integrated.
 */
export function attachQueuedPhotoToWorkOrder(
  item: QueuedPhotoUpload,
  workOrderId: string,
  now: number
): QueuedPhotoUpload {
  const { intakeDraftId: _removed, ...fields } = item as QueuedPhotoUpload & {
    intakeDraftId?: string;
  };
  return {
    ...fields,
    workOrderId,
    updatedAt: now,
  };
}

export function createManualRetryState(
  item: QueuedPhotoUpload,
  now: number
): QueuedPhotoUpload {
  assertPhotoUploadTransition(item.status, "queued");
  return {
    ...item,
    status: "queued",
    attemptCount: 0,
    retryAt: null,
    lastError: null,
    updatedAt: now,
    leaseOwner: null,
    leaseExpiresAt: null,
    uploadSlotOwner: null,
    uploadSlotExpiresAt: null,
  };
}

export function createPhotoUploadFailureSettlement(
  persistedFailureCount: number,
  outcome: PhotoUploadFailureOutcome,
  now: number,
  policy: PhotoUploadRetryPolicy
): PhotoUploadFailureSettlement {
  const attemptCount = persistedFailureCount + 1;
  const failed = !outcome.retryable || attemptCount >= policy.maxAttempts;
  const retryDelay = Math.min(
    policy.baseRetryDelayMs * 2 ** Math.max(0, attemptCount - 1),
    policy.maxRetryDelayMs
  );
  return {
    status: failed ? "failed" : "retry_wait",
    attemptCount,
    retryAt: failed ? null : now + retryDelay,
    lastError: outcome.message,
    updatedAt: now,
  };
}

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
  /**
   * Atomically reserves the item and a scope slot without changing the
   * persisted failed-outcome count.
   */
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
  /**
   * Owner-fenced transaction that records one uploader failure, derives
   * backoff/terminal state from the new count, and releases the claim.
   */
  settleClaimedFailure(
    queueId: string,
    scope: PhotoUploadScope,
    owner: string,
    now: number,
    outcome: PhotoUploadFailureOutcome,
    policy: PhotoUploadRetryPolicy
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
  attachDraftToWorkOrder(
    scope: PhotoUploadScope,
    intakeDraftId: string,
    workOrderId: string,
    now: number
  ): Promise<QueuedPhotoUpload[]>;
  retryFailed(
    queueId: string,
    scope: PhotoUploadScope,
    now: number
  ): Promise<QueuedPhotoUpload | null>;
  removeUnclaimed(
    queueId: string,
    scope: PhotoUploadScope,
    now: number
  ): Promise<boolean>;
  replaceDraftCategory(
    scope: PhotoUploadScope,
    intakeDraftId: string,
    category: string,
    item: QueuedPhotoUpload,
    now: number
  ): Promise<QueuedPhotoUpload>;
}
