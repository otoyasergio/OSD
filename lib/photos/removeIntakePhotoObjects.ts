import "server-only";

import { PHOTO_UPLOAD_RETRY_ATTEMPTS } from "@/lib/forms/photoUploadErrors";
import { classifyStorageUploadError } from "@/lib/forms/storageUploadRetry";

export type IntakePhotoStorageRemoveError = {
  message?: string | null;
  statusCode?: string | number | null;
} | null;

export type RemoveIntakePhotoObjectsInput = {
  remove(paths: string[]): Promise<{ error: IntakePhotoStorageRemoveError }>;
  paths: string[];
  logFailure(details: { stage: "cleanup"; pathCount: number; statusCode?: string }): void;
  retryAttempts?: number;
  sleep?(ms: number): Promise<void>;
};

function statusCodeOf(error: IntakePhotoStorageRemoveError): string | undefined {
  if (!error || error.statusCode == null) return undefined;
  return String(error.statusCode);
}

function isAlreadyGone(error: IntakePhotoStorageRemoveError): boolean {
  if (!error) return false;
  const code = statusCodeOf(error);
  const message = (error.message ?? "").toLowerCase();
  return code === "404" || message.includes("not found") || message.includes("no such");
}

export async function removeIntakePhotoObjects(
  input: RemoveIntakePhotoObjectsInput
): Promise<void> {
  if (input.paths.length === 0) return;

  const attempts = input.retryAttempts ?? PHOTO_UPLOAD_RETRY_ATTEMPTS;
  const sleep =
    input.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  let lastError: IntakePhotoStorageRemoveError = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const { error } = await input.remove(input.paths);
    const kind = classifyStorageUploadError(error);
    if (kind === "ok" || kind === "exists" || isAlreadyGone(error)) return;
    lastError = error;
    if (kind === "fail" || attempt === attempts - 1) break;
    await sleep(250 * 2 ** attempt);
  }

  input.logFailure({
    stage: "cleanup",
    pathCount: input.paths.length,
    ...(statusCodeOf(lastError) ? { statusCode: statusCodeOf(lastError) } : {}),
  });
  throw new Error("PHOTO_UPLOAD_FAILED");
}
