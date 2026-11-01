"use server";

import { revalidatePath } from "next/cache";
import { removeCustomerPhoto, uploadCustomerPhoto } from "@/lib/services/customerPhotos";
import { toFormErrorMessage } from "@/lib/services/errors";

export type CustomerPhotoFormState = {
  error: string | null;
  success: "updated" | "removed" | null;
  resetKey: number;
};

function revalidateCustomerPhoto(customerId: string) {
  revalidatePath("/customers");
  revalidatePath(`/customers/${customerId}`);
}

export async function uploadCustomerPhotoAction(
  customerId: string,
  previousState: CustomerPhotoFormState,
  formData: FormData
): Promise<CustomerPhotoFormState> {
  try {
    await uploadCustomerPhoto(customerId, formData.get("file") as File);
    revalidateCustomerPhoto(customerId);
    return {
      error: null,
      success: "updated",
      resetKey: previousState.resetKey + 1,
    };
  } catch (error) {
    return {
      error: toFormErrorMessage(error),
      success: null,
      resetKey: previousState.resetKey,
    };
  }
}

export async function removeCustomerPhotoAction(
  customerId: string,
  previousState: CustomerPhotoFormState,
  _formData: FormData
): Promise<CustomerPhotoFormState> {
  try {
    await removeCustomerPhoto(customerId);
    revalidateCustomerPhoto(customerId);
    return {
      error: null,
      success: "removed",
      resetKey: previousState.resetKey + 1,
    };
  } catch (error) {
    return {
      error: toFormErrorMessage(error),
      success: null,
      resetKey: previousState.resetKey,
    };
  }
}
