import type { PhotoUploadStatus } from "./types";

export class InvalidPhotoUploadTransitionError extends Error {
  readonly name = "InvalidPhotoUploadTransitionError";

  constructor(from: PhotoUploadStatus, to: PhotoUploadStatus) {
    super(`Cannot transition a photo upload from ${from} to ${to}.`);
  }
}

const ALLOWED_TRANSITIONS: Record<PhotoUploadStatus, readonly PhotoUploadStatus[]> = {
  preparing: ["queued"],
  queued: ["uploading"],
  uploading: ["retry_wait", "saved", "failed"],
  retry_wait: ["uploading"],
  saved: [],
  failed: [],
};

export function assertPhotoUploadTransition(
  from: PhotoUploadStatus,
  to: PhotoUploadStatus
): void {
  if (from === to || ALLOWED_TRANSITIONS[from].includes(to)) return;
  throw new InvalidPhotoUploadTransitionError(from, to);
}
