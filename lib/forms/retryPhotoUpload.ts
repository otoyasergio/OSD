import {
  PHOTO_UPLOAD_RETRY_ATTEMPTS,
  PHOTO_UPLOAD_RETRY_BASE_MS,
  isRetryablePhotoUploadFailure,
} from "@/lib/forms/photoUploadErrors";

export type RetryPhotoUploadOptions<T> = {
  isSuccess: (value: T) => boolean;
  getFailureMessage?: (value: T) => string | null;
  sleep?: (ms: number) => Promise<void>;
  attempts?: number;
};

/**
 * Retry a photo upload a few times on transient network/storage errors.
 * Permanent errors (type, size, permission) are returned immediately.
 */
export async function withPhotoUploadRetries<T>(
  run: () => Promise<T>,
  options: RetryPhotoUploadOptions<T>
): Promise<T> {
  const attempts = options.attempts ?? PHOTO_UPLOAD_RETRY_ATTEMPTS;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  let last: T | undefined;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await run();
    if (options.isSuccess(last)) return last;

    const message = options.getFailureMessage?.(last) ?? null;
    if (!isRetryablePhotoUploadFailure(message) || attempt === attempts - 1) {
      return last;
    }
    await sleep(PHOTO_UPLOAD_RETRY_BASE_MS * 2 ** attempt);
  }

  return last as T;
}
