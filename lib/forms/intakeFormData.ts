import type { PhotoCategory } from "@/lib/database/types";
import type { IntakePhotoSelection } from "@/components/forms/IntakePhotoSlots";

/** Prefer React-state Files over clipped/sr-only DOM inputs (Safari/wizard). */
export function appendIntakePhotosToFormData(
  formData: FormData,
  photos: IntakePhotoSelection,
  categories: PhotoCategory[]
): FormData {
  for (const category of categories) {
    const key = `intake_${category}`;
    const file = photos[category];
    if (file instanceof File && file.size > 0) {
      formData.set(key, file);
    } else {
      formData.delete(key);
    }
  }
  return formData;
}

/** Remove intake file fields so create requests stay small. */
export function stripIntakePhotoFields(
  formData: FormData,
  categories: PhotoCategory[]
): FormData {
  for (const category of categories) {
    formData.delete(`intake_${category}`);
  }
  return formData;
}
