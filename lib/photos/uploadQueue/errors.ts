export type PhotoQueuePersistenceErrorCode = "quota_exceeded" | "persistence_failed";

export class PhotoUploadQueueClosedError extends Error {
  readonly name = "PhotoUploadQueueClosedError";

  constructor() {
    super("The photo upload queue is no longer available.");
  }
}

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
