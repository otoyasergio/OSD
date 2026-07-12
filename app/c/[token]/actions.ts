"use server";

import { revalidatePath } from "next/cache";
import {
  portalAcknowledgeInspection,
  portalApproveJob,
  portalDeclineJob,
  portalSignContract,
} from "@/lib/services/portal";
import { getActiveAgreementTemplate } from "@/lib/services/contracts";
import { toFormErrorMessage } from "@/lib/services/errors";

export async function portalApproveJobAction(
  token: string,
  jobId: string
): Promise<{ error: string | null }> {
  try {
    await portalApproveJob(token, jobId);
    revalidatePath(`/c/${token}`);
    return { error: null };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}

export async function portalDeclineJobAction(
  token: string,
  jobId: string,
  reason: string
): Promise<{ error: string | null }> {
  try {
    await portalDeclineJob(token, jobId, reason);
    revalidatePath(`/c/${token}`);
    return { error: null };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}

export async function portalSignContractAction(
  token: string,
  formData: FormData
): Promise<{ error: string | null }> {
  try {
    await portalSignContract(token, {
      signer_name: String(formData.get("signer_name") ?? ""),
      initials: JSON.parse(String(formData.get("initials") ?? "{}")) as Record<
        string,
        string
      >,
      signature_data_url: String(formData.get("signature_data_url") ?? ""),
    });
    revalidatePath(`/c/${token}`);
    return { error: null };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}

export async function portalAckInspectionAction(
  token: string,
  signerName: string,
  signatureDataUrl?: string
): Promise<{ error: string | null }> {
  try {
    await portalAcknowledgeInspection(token, {
      signer_name: signerName,
      signature_data_url: signatureDataUrl,
    });
    revalidatePath(`/c/${token}`);
    return { error: null };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}

export async function loadPortalContractTemplateAction() {
  return getActiveAgreementTemplate();
}
