"use server";

import { revalidatePath } from "next/cache";
import { uploadIntakePhoto } from "@/lib/services/photos";
import { toFormErrorMessage } from "@/lib/services/errors";
import type { PhotoCategory } from "@/lib/database/types";

export type PhotoFormState = { error: string | null };

function revalidatePhotos(workOrderId: string) {
  revalidatePath(`/work_orders/${workOrderId}`);
  revalidatePath("/work_orders");
  revalidatePath("/dashboard");
}

export async function uploadIntakePhotoAction(
  workOrderId: string,
  _prevState: PhotoFormState,
  formData: FormData
): Promise<PhotoFormState> {
  try {
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return { error: toFormErrorMessage(new Error("PHOTO_REQUIRED")) };
    }

    await uploadIntakePhoto(workOrderId, {
      category: String(formData.get("category") ?? "") as PhotoCategory,
      notes: String(formData.get("notes") ?? "").trim() || null,
      file,
    });
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidatePhotos(workOrderId);
  return { error: null };
}
