"use server";

import { revalidatePath } from "next/cache";
import { uploadIntakePhoto } from "@/lib/services/photos";
import { toFormErrorMessage } from "@/lib/services/errors";
import type { PhotoCategory } from "@/lib/database/types";

export type PhotoFormState = { error: string | null };

function revalidatePhotos(workOrderId: string) {
  revalidatePath(`/work_orders/${workOrderId}`);
  revalidatePath(`/work_orders/${workOrderId}/inspection`);
  revalidatePath("/work_orders");
  revalidatePath("/dashboard");
  revalidatePath("/technician");
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

    const resultId = String(formData.get("inspection_result_id") ?? "").trim();
    await uploadIntakePhoto(workOrderId, {
      category: String(formData.get("category") ?? "") as PhotoCategory,
      notes: String(formData.get("notes") ?? "").trim() || null,
      inspection_result_id: resultId || null,
      file,
    });
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidatePhotos(workOrderId);
  return { error: null };
}
