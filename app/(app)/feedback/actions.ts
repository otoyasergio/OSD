"use server";

import { revalidatePath } from "next/cache";
import { toFormErrorMessage } from "@/lib/services/errors";
import { submitStaffFeedback } from "@/lib/services/staffFeedback";

export type StaffFeedbackFormState = {
  error: string | null;
  receipt: string | null;
};

export async function submitStaffFeedbackAction(
  _prev: StaffFeedbackFormState,
  formData: FormData
): Promise<StaffFeedbackFormState> {
  try {
    const screenshot = formData.get("screenshot");
    const skipPicture = formData.get("skip_picture") === "1";
    await submitStaffFeedback({
      note: String(formData.get("note") ?? ""),
      pagePath: String(formData.get("page_path") ?? ""),
      viewportWidth: formData.get("viewport_width"),
      viewportHeight: formData.get("viewport_height"),
      screenshot:
        skipPicture || !(screenshot instanceof File) || screenshot.size === 0
          ? null
          : screenshot,
    });
  } catch (error) {
    return { error: toFormErrorMessage(error), receipt: null };
  }
  revalidatePath("/settings/logs");
  return { error: null, receipt: crypto.randomUUID() };
}
