import type { PhotoUploadQueueStore } from "./store";
import type { PhotoUploadScope, QueuedPhotoUpload } from "./types";
import { assertPhotoUploadTransition } from "./stateTransitions";
import { PhotoQueuePersistenceError } from "./errors";

export { PhotoQueuePersistenceError } from "./errors";

export type EnqueuePhotoUploadOptions = {
  store: PhotoUploadQueueStore;
  scope: PhotoUploadScope;
  item: QueuedPhotoUpload;
  now: number;
};

export async function enqueuePhotoUpload({
  store,
  scope,
  item,
  now,
}: EnqueuePhotoUploadOptions): Promise<QueuedPhotoUpload> {
  assertPhotoUploadTransition(item.status, "queued");
  const queued: QueuedPhotoUpload = {
    ...item,
    status: "queued",
    updatedAt: now,
  };
  try {
    await store.put(scope, queued);
  } catch (error) {
    if (error instanceof PhotoQueuePersistenceError) throw error;
    const isQuotaError =
      typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === "QuotaExceededError";
    throw new PhotoQueuePersistenceError(
      isQuotaError ? "quota_exceeded" : "persistence_failed",
      isQuotaError
        ? "This device does not have enough storage to queue the photo."
        : "The photo could not be saved to the upload queue.",
      { cause: error }
    );
  }
  return queued;
}
