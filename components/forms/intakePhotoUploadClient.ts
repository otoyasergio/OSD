"use client";

import { uploadIntakePhotoAction } from "@/app/(app)/work_orders/photo-actions";
import type { PhotoCategory } from "@/lib/database/types";
import {
  UNREADABLE_PHOTO_MESSAGE,
  describePhotoUploadFailure,
  photoTooLargeMessage,
} from "@/lib/forms/photoUploadErrors";
import { preparePhotoFileForUpload } from "@/lib/forms/preparePhotoFileForUpload";
import { withPhotoUploadRetries } from "@/lib/forms/retryPhotoUpload";
import { exceedsServerActionUploadLimit } from "@/lib/forms/uploadLimits";
import { toFormErrorMessage } from "@/lib/services/errors";
import { PHOTO_CATEGORY_LABELS } from "@/lib/status/labels";

export type IntakePhotoUploadResult = {
  uploaded: boolean;
  /** User-facing reason when `uploaded` is false. */
  error: string | null;
};

function failure(error: string): IntakePhotoUploadResult {
  return { uploaded: false, error };
}

export async function uploadSelectedIntakePhoto(
  workOrderId: string,
  original: File,
  category: PhotoCategory
): Promise<IntakePhotoUploadResult> {
  if (!original || typeof original.arrayBuffer !== "function") {
    return failure(UNREADABLE_PHOTO_MESSAGE);
  }

  try {
    const file = await preparePhotoFileForUpload(original);
    if (file.size === 0) return failure(UNREADABLE_PHOTO_MESSAGE);
    // Vercel drops the request before the app sees it, so check here where we
    // can still explain what happened instead of surfacing a blank crash.
    if (exceedsServerActionUploadLimit(file)) return failure(photoTooLargeMessage(file));

    const result = await withPhotoUploadRetries(
      async () => {
        try {
          const photoData = new FormData();
          photoData.set("file", file);
          photoData.set("category", category);
          return await uploadIntakePhotoAction(workOrderId, { error: null }, photoData);
        } catch (error) {
          return { error: describePhotoUploadFailure(error) };
        }
      },
      {
        isSuccess: (value) => !value.error,
        getFailureMessage: (value) => value.error,
      }
    );
    return result.error ? failure(result.error) : { uploaded: true, error: null };
  } catch (error) {
    return failure(describePhotoUploadFailure(error));
  }
}

/** Optional extras are sequential, compressed uploads stored as category `other`. */
export async function uploadOptionalIntakePhotos(
  workOrderId: string,
  files: File[]
): Promise<number> {
  let failed = 0;

  for (const file of files) {
    const result = await uploadSelectedIntakePhoto(workOrderId, file, "other");
    if (!result.uploaded) failed += 1;
  }

  return failed;
}

/**
 * "…some intake photos failed to upload. Missing: Front, Left. That photo is
 * 6.2 MB — over the 4 MB upload limit. …" — the specific reason is what lets
 * the person fix it instead of retrying the same photo into the same wall.
 */
export function intakePhotoFailureMessage(
  failed: PhotoCategory[],
  results: (IntakePhotoUploadResult | null | undefined)[]
): string {
  const labels = failed.map((c) => PHOTO_CATEGORY_LABELS[c] ?? c).join(", ");
  const base = `${toFormErrorMessage(new Error("INTAKE_PHOTOS_PARTIAL"))} Missing: ${labels}.`;
  const reason = results.find((result) => result && result.error)?.error;
  return reason ? `${base} ${reason}` : base;
}

export function intakeContractHref(
  workOrderId: string,
  optionalPhotoFailures = 0
): string {
  const params = new URLSearchParams({ from: "intake" });
  if (optionalPhotoFailures > 0) {
    params.set("extra_photo_failures", String(optionalPhotoFailures));
  }
  return `/work_orders/${workOrderId}/contract?${params.toString()}`;
}
