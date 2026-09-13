"use client";

import { uploadIntakePhotoAction } from "@/app/(app)/work_orders/photo-actions";
import type { PhotoCategory } from "@/lib/database/types";
import { preparePhotoFileForUpload } from "@/lib/forms/preparePhotoFileForUpload";
import { withPhotoUploadRetries } from "@/lib/forms/retryPhotoUpload";

export async function uploadSelectedIntakePhoto(
  workOrderId: string,
  original: File,
  category: PhotoCategory
): Promise<boolean> {
  if (!(original instanceof File) || original.size === 0) return false;

  try {
    const file = await preparePhotoFileForUpload(original);
    const uploaded = await withPhotoUploadRetries(
      async () => {
        const photoData = new FormData();
        photoData.set("file", file);
        photoData.set("category", category);
        return uploadIntakePhotoAction(workOrderId, { error: null }, photoData);
      },
      {
        isSuccess: (result) => !result.error,
        getFailureMessage: (result) => result.error,
      }
    );
    return !uploaded.error;
  } catch {
    return false;
  }
}

/** Optional extras are sequential, compressed uploads stored as category `other`. */
export async function uploadOptionalIntakePhotos(
  workOrderId: string,
  files: File[]
): Promise<number> {
  let failed = 0;

  for (const file of files) {
    const uploaded = await uploadSelectedIntakePhoto(workOrderId, file, "other");
    if (!uploaded) failed += 1;
  }

  return failed;
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
