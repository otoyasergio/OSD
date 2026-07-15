"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import {
  markDropOffAgreementSignedOnPaper,
  signDropOffAgreement,
} from "@/lib/services/contracts";
import { toFormErrorMessage } from "@/lib/services/errors";
import { uploadPaperDropOffAgreementCopy } from "@/lib/services/customerDocuments";

export async function signDropOffAgreementAction(
  workOrderId: string,
  formData: FormData
): Promise<{ error: string | null }> {
  try {
    const headersList = await headers();
    if (String(formData.get("signature_method") ?? "") === "paper") {
      await markDropOffAgreementSignedOnPaper(workOrderId, {
        ip_address: headersList.get("x-forwarded-for"),
        user_agent: headersList.get("user-agent"),
      });
    } else {
      await signDropOffAgreement(workOrderId, {
        signer_name: String(formData.get("signer_name") ?? ""),
        initials: JSON.parse(String(formData.get("initials") ?? "{}")) as Record<
          string,
          string
        >,
        signature_data_url: String(formData.get("signature_data_url") ?? ""),
        ip_address: headersList.get("x-forwarded-for"),
        user_agent: headersList.get("user-agent"),
      });
    }
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidatePath(`/work_orders/${workOrderId}`);
  revalidatePath(`/work_orders/${workOrderId}/contract`);
  revalidatePath("/work_orders");
  revalidatePath("/dashboard");
  revalidatePath("/control-center");
  return { error: null };
}

export async function uploadPaperAgreementCopyAction(
  workOrderId: string,
  formData: FormData
): Promise<{ error: string | null }> {
  try {
    const file = formData.get("file");
    if (!(file instanceof File)) throw new Error("DOCUMENT_REQUIRED");
    await uploadPaperDropOffAgreementCopy(workOrderId, { file });
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidatePath(`/work_orders/${workOrderId}`);
  revalidatePath(`/work_orders/${workOrderId}/contract`);
  revalidatePath("/work_orders");
  return { error: null };
}
