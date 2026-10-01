export type PhotoQueuePersistenceErrorCode = "quota_exceeded" | "persistence_failed";

export class PhotoQueuePersistenceError extends Error {
  readonly name = "PhotoQueuePersistenceError";

  constructor(
    readonly code: PhotoQueuePersistenceErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
  }
}
