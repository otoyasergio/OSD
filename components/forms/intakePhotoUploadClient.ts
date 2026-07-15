"use client";

import { uploadIntakePhotoAction } from "@/app/(app)/work_orders/photo-actions";
import type { PhotoCategory } from "@/lib/database/types";
import { compressImageForUpload } from "@/lib/forms/compressImageForUpload";

export async function uploadSelectedIntakePhoto(
  workOrderId: string,
  original: File,
  category: PhotoCategory
): Promise<boolean> {
  if (!(original instanceof File) || original.size === 0) return false;

  try {
    const file = await compressImageForUpload(original);
    const photoData = new FormData();
    photoData.set("file", file);
    photoData.set("category", category);
    const uploaded = await uploadIntakePhotoAction(
      workOrderId,
      { error: null },
      photoData
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
