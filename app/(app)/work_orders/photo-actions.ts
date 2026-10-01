"use server";

import { revalidatePath } from "next/cache";
import { deleteIntakePhoto, uploadIntakePhoto } from "@/lib/services/photos";
import { toFormErrorMessage } from "@/lib/services/errors";
import type { PhotoCategory } from "@/lib/database/types";
import { collectPhotoFiles } from "@/lib/forms/photoFiles";

export type PhotoFormState = {
  error: string | null;
  photoId?: string;
  clientUploadId?: string;
  thumbUrl?: string | null;
};

function revalidatePhotos(workOrderId: string) {
  revalidatePath(`/work_orders/${workOrderId}`);
  revalidatePath(`/work_orders/${workOrderId}/inspection`);
  revalidatePath("/work_orders");
  revalidatePath("/dashboard");
  revalidatePath("/technician");
  revalidatePath("/gallery");
}

export async function uploadIntakePhotoAction(
  workOrderId: string,
  _prevState: PhotoFormState,
  formData: FormData
): Promise<PhotoFormState> {
  try {
    const files = collectPhotoFiles(formData);
    if (files.length === 0) {
      return { error: toFormErrorMessage(new Error("PHOTO_REQUIRED")) };
    }

    const resultId = String(formData.get("inspection_result_id") ?? "").trim();
    const category = String(formData.get("category") ?? "") as PhotoCategory;
    const notes = String(formData.get("notes") ?? "").trim() || null;
    const clientUploadId =
      String(formData.get("client_upload_id") ?? "").trim() || undefined;
    let saved = 0;
    let firstError: string | null = null;
    let confirmation: Awaited<ReturnType<typeof uploadIntakePhoto>> | null = null;
    for (const [index, file] of files.entries()) {
      try {
        const upload = {
          category,
          notes,
          inspection_result_id: resultId || null,
          file,
          ...(clientUploadId && index === 0 ? { client_upload_id: clientUploadId } : {}),
        };
        const photo = await uploadIntakePhoto(workOrderId, upload);
        confirmation ??= photo;
        saved += 1;
      } catch (error) {
        if (!firstError) firstError = toFormErrorMessage(error);
      }
    }
    if (saved > 0) revalidatePhotos(workOrderId);
    if (!confirmation) return { error: firstError };
    return {
      error: firstError,
      photoId: confirmation.photo_id,
      ...(confirmation.client_upload_id
        ? { clientUploadId: confirmation.client_upload_id }
        : {}),
      thumbUrl: confirmation.thumb_url ?? null,
    };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}

export async function deleteIntakePhotoAction(
  workOrderId: string,
  _prevState: PhotoFormState,
  formData: FormData
): Promise<PhotoFormState> {
  try {
    const photoId = String(formData.get("photo_id") ?? "").trim();
    if (!photoId) {
      return { error: toFormErrorMessage(new Error("PHOTO_NOT_FOUND")) };
    }
    await deleteIntakePhoto(workOrderId, photoId);
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidatePhotos(workOrderId);
  return { error: null };
}
