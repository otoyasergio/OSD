"use server";

import { revalidatePath } from "next/cache";
import {
  removeOwnProfilePhoto,
  uploadOwnProfilePhoto,
} from "@/lib/services/profilePhotos";
import { toFormErrorMessage } from "@/lib/services/errors";

export type ProfilePhotoFormState = {
  error: string | null;
  success: "updated" | "removed" | null;
  resetKey: number;
};

function revalidateProfilePhotoViews() {
  revalidatePath("/account");
  revalidatePath("/", "layout");
  revalidatePath("/messages/directory");
}

export async function uploadProfilePhotoAction(
  previousState: ProfilePhotoFormState,
  formData: FormData
): Promise<ProfilePhotoFormState> {
  try {
    await uploadOwnProfilePhoto(formData.get("file") as File);
    revalidateProfilePhotoViews();
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

export async function removeProfilePhotoAction(
  previousState: ProfilePhotoFormState,
  _formData: FormData
): Promise<ProfilePhotoFormState> {
  try {
    await removeOwnProfilePhoto();
    revalidateProfilePhotoViews();
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
