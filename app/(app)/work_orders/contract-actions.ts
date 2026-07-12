"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { signDropOffAgreement } from "@/lib/services/contracts";
import { toFormErrorMessage } from "@/lib/services/errors";

export async function signDropOffAgreementAction(
  workOrderId: string,
  formData: FormData
): Promise<{ error: string | null }> {
  try {
    const headersList = await headers();
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
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidatePath(`/work_orders/${workOrderId}`);
  revalidatePath(`/work_orders/${workOrderId}/contract`);
  return { error: null };
}
