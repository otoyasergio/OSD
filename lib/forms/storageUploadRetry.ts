export type StorageUploadErrorKind = "ok" | "exists" | "retry" | "fail";

type StorageLikeError = {
  message?: string | null;
  statusCode?: string | number | null;
} | null;

/**
 * Classify a Supabase Storage upload error so callers can retry transient
 * failures without treating a duplicate object as a hard failure.
 */
export function classifyStorageUploadError(
  error: StorageLikeError
): StorageUploadErrorKind {
  if (!error) return "ok";

  const code = String(error.statusCode ?? "");
  const message = (error.message ?? "").toLowerCase();

  if (
    code === "409" ||
    message.includes("already exists") ||
    message.includes("duplicate")
  ) {
    return "exists";
  }

  if (
    code === "413" ||
    message.includes("too large") ||
    message.includes("payload too") ||
    message.includes("exceeded the maximum")
  ) {
    return "fail";
  }

  return "retry";
}
