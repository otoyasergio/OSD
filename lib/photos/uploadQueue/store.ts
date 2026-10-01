import type { PhotoUploadQueuePatch, PhotoUploadScope, QueuedPhotoUpload } from "./types";

export class PhotoUploadQueueScopeError extends Error {
  readonly name = "PhotoUploadQueueScopeError";

  constructor() {
    super("Photo upload does not belong to the provided scope.");
  }
}

export type PhotoUploadClaim = {
  expiresAt: number;
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
  recoverInterrupted(scope: PhotoUploadScope, now: number): Promise<number>;
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
    maxScopeSlots: number
  ): Promise<PhotoUploadClaim | null>;
  renewUploadClaim(
    queueId: string,
    scope: PhotoUploadScope,
    owner: string,
    now: number,
    ttlMs: number
  ): Promise<PhotoUploadClaim | null>;
  updateClaimed(
    queueId: string,
    scope: PhotoUploadScope,
    owner: string,
    now: number,
    patch: PhotoUploadQueuePatch,
    releaseClaim?: boolean
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
    now: number
  ): Promise<boolean>;
}
