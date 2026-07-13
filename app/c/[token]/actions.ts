"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  portalAcknowledgeInspection,
  portalApproveJob,
  portalDeclineJob,
  portalSignContract,
  portalUpdateSmsConsent,
} from "@/lib/services/portal";
import { getActiveAgreementTemplate } from "@/lib/services/contracts";
import { toFormErrorMessage } from "@/lib/services/errors";
import { dropOffAgreementSchema } from "@/lib/validation/schemas";
import { rateLimit } from "@/lib/security/rateLimit";

async function assertPortalRateLimit(token: string): Promise<void> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  const result = rateLimit({
    key: `portal:${token.slice(0, 8)}:${ip}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (!result.success) {
    throw new Error("RATE_LIMITED");
  }
}

export async function portalApproveJobAction(
  token: string,
  jobId: string
): Promise<{ error: string | null }> {
  try {
    await assertPortalRateLimit(token);
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
    await assertPortalRateLimit(token);
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
    await assertPortalRateLimit(token);
    let initials: Record<string, string> = {};
    try {
      initials = JSON.parse(String(formData.get("initials") ?? "{}")) as Record<
        string,
        string
      >;
    } catch {
      throw new Error("INVALID_INITIALS");
    }

    const parsed = dropOffAgreementSchema.parse({
      signer_name: String(formData.get("signer_name") ?? ""),
      initials,
      signature_data_url: String(formData.get("signature_data_url") ?? ""),
    });

    await portalSignContract(token, parsed);
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
    await assertPortalRateLimit(token);
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

export async function portalUpdateSmsConsentAction(
  token: string,
  formData: FormData
): Promise<{ error: string | null }> {
  const transactional = formData.get("sms_transactional") === "on";
  const marketing = formData.get("sms_marketing") === "on";

  if (!transactional && !marketing) {
    return { error: "Choose at least one message type." };
  }

  try {
    await assertPortalRateLimit(token);
    await portalUpdateSmsConsent(token, { transactional, marketing });
    revalidatePath(`/c/${token}`);
    return { error: null };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}

export async function loadPortalContractTemplateAction() {
  return getActiveAgreementTemplate();
}
