"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  portalAcknowledgeInspection,
  portalApproveJob,
  portalConfirmEstimate,
  portalDeclineJob,
  portalEstimateErrorMessage,
  portalSignContract,
} from "@/lib/services/portal";
import { toFormErrorMessage } from "@/lib/services/errors";
import { dropOffAgreementSchema } from "@/lib/validation/schemas";
import { rateLimit } from "@/lib/security/rateLimit";

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

function toPortalEstimateError(error: unknown): string {
  if (error instanceof Error) {
    const mapped = portalEstimateErrorMessage(error.message);
    if (mapped) return mapped;
  }
  return toFormErrorMessage(error);
}

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

export async function portalConfirmEstimateAction(
  token: string,
  formData: FormData
): Promise<{ error: string | null }> {
  try {
    await assertPortalRateLimit(token);

    let decisions: unknown = [];
    try {
      decisions = JSON.parse(String(formData.get("decisions") ?? "[]"));
    } catch {
      throw new Error("DECISION_MISSING");
    }
    const parsed = portalConfirmEstimateSchema.parse({
      signerName: String(formData.get("signer_name") ?? ""),
      expectedContentHash: String(formData.get("expected_content_hash") ?? ""),
      decisions,
    });

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
    return { error: toPortalEstimateError(error) };
  }
}
