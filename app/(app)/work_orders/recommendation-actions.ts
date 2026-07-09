"use server";

import { revalidatePath } from "next/cache";
import {
  convertRecommendationToJob,
  createRecommendation,
  createRecommendationFromInspectionResult,
  listOutstandingRecommendationsForMotorcycle,
  type OutstandingRecommendation,
  updateRecommendationStatus,
} from "@/lib/services/recommendations";
import { toFormErrorMessage } from "@/lib/services/errors";
import type {
  RecommendationSeverity,
  RecommendationStatus,
} from "@/lib/database/types";

export type RecommendationFormState = { error: string | null };

export async function getOutstandingRecommendationsAction(
  motorcycleId: string
): Promise<OutstandingRecommendation[]> {
  if (!motorcycleId) return [];
  return listOutstandingRecommendationsForMotorcycle(motorcycleId);
}

function revalidateRecommendations(workOrderId: string) {
  revalidatePath(`/work_orders/${workOrderId}`);
  revalidatePath(`/work_orders/${workOrderId}/inspection`);
  revalidatePath("/work_orders");
}

export async function createRecommendationAction(
  workOrderId: string,
  _prevState: RecommendationFormState,
  formData: FormData
): Promise<RecommendationFormState> {
  try {
    const fromResult = String(formData.get("inspection_result_id") ?? "").trim();
    if (fromResult) {
      const severityRaw = String(formData.get("severity") ?? "").trim();
      await createRecommendationFromInspectionResult(fromResult, {
        description: String(formData.get("description") ?? "").trim() || undefined,
        severity: severityRaw
          ? (severityRaw as RecommendationSeverity)
          : undefined,
        notes: String(formData.get("notes") ?? "").trim() || null,
      });
    } else {
      await createRecommendation(workOrderId, {
        description: String(formData.get("description") ?? "").trim(),
        severity: String(formData.get("severity") ?? "") as RecommendationSeverity,
        notes: String(formData.get("notes") ?? "").trim() || null,
      });
    }
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidateRecommendations(workOrderId);
  return { error: null };
}

export async function updateRecommendationStatusAction(
  workOrderId: string,
  recommendationId: string,
  _prevState: RecommendationFormState,
  formData: FormData
): Promise<RecommendationFormState> {
  try {
    const status = String(formData.get("status") ?? "") as Exclude<
      RecommendationStatus,
      "converted_to_job" | "pending"
    >;
    await updateRecommendationStatus(
      recommendationId,
      status,
      String(formData.get("notes") ?? "").trim() || null
    );
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidateRecommendations(workOrderId);
  return { error: null };
}

export async function convertRecommendationAction(
  workOrderId: string,
  recommendationId: string,
  _prevState: RecommendationFormState,
  formData: FormData
): Promise<RecommendationFormState> {
  try {
    await convertRecommendationToJob(recommendationId, {
      service_id: String(formData.get("service_id") ?? ""),
      already_approved: formData.get("already_approved") === "true",
    });
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidateRecommendations(workOrderId);
  return { error: null };
}
