"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  portalAcknowledgeInspection,
  portalApproveJob,
  portalConfirmEstimate,
  portalDeclineJob,
  portalSignContract,
} from "@/lib/services/portal";
import { getActiveAgreementTemplate } from "@/lib/services/contracts";
import { toFormErrorMessage } from "@/lib/services/errors";
import { dropOffAgreementSchema } from "@/lib/validation/schemas";
import { rateLimit } from "@/lib/security/rateLimit";

const PORTAL_ESTIMATE_ERRORS: Record<string, string> = {
  ESTIMATE_NOT_PRESENTED: "This estimate is no longer open for decisions.",
  ESTIMATE_ALREADY_CONFIRMED:
    "Your decisions were already recorded. Refresh to see the summary.",
  ESTIMATE_CONTENT_STALE:
    "This estimate changed — refresh the page to review the latest version.",
  DECISION_MISSING: "Choose approve or decline for every item before confirming.",
  DECISION_FOR_UNKNOWN_JOB:
    "This estimate changed — refresh the page to review the latest version.",
  DUPLICATE_DECISION: "Something duplicated a decision. Refresh and try again.",
  FORBIDDEN: "This link cannot record estimate decisions.",
};

const portalConfirmEstimateSchema = z.object({
  signerName: z.string().trim().min(1, "Enter your full name").max(120),
  expectedContentHash: z.string().min(1),
  decisions: z
    .array(
      z.object({
        jobId: z.string().uuid(),
        decision: z.enum(["approved", "declined"]),
      })
    )
    .min(1),
});

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

export async function loadPortalContractTemplateAction() {
  return getActiveAgreementTemplate();
}

export async function portalConfirmEstimateAction(
  token: string,
  payload: {
    decisions: Array<{ jobId: string; decision: "approved" | "declined" }>;
    expectedContentHash: string;
    signerName: string;
  }
): Promise<{ error: string | null }> {
  try {
    await assertPortalRateLimit(token);
    const parsed = portalConfirmEstimateSchema.parse(payload);

    const h = await headers();
    const forwarded = h.get("x-forwarded-for");
    await portalConfirmEstimate(token, {
      decisions: parsed.decisions,
      expectedContentHash: parsed.expectedContentHash,
      signerName: parsed.signerName,
      ipAddress: forwarded?.split(",")[0]?.trim() || h.get("x-real-ip") || null,
      userAgent: h.get("user-agent"),
    });

    revalidatePath(`/c/${token}`);
    return { error: null };
  } catch (error) {
    if (error instanceof Error && PORTAL_ESTIMATE_ERRORS[error.message]) {
      return { error: PORTAL_ESTIMATE_ERRORS[error.message] };
    }
    return { error: toFormErrorMessage(error) };
  }
}
