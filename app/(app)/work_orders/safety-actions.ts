"use server";

import { revalidatePath } from "next/cache";
import { toFormErrorMessage } from "@/lib/services/errors";
import type { RecommendationSeverity } from "@/lib/database/types";
import {
  failSafetyCheck,
  overrideSafetyRequirement,
  passSafetyCheck,
} from "@/lib/services/safety";

export type SafetyFormState = { error: string | null };

function revalidateWorkOrder(workOrderId: string) {
  revalidatePath(`/work_orders/${workOrderId}`);
  revalidatePath("/work_orders");
  revalidatePath("/dashboard");
  revalidatePath("/technician");
}

export async function passSafetyCheckAction(
  workOrderId: string,
  _prevState: SafetyFormState,
  formData: FormData
): Promise<SafetyFormState> {
  try {
    await passSafetyCheck(workOrderId, String(formData.get("safety_check_notes") ?? ""));
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidateWorkOrder(workOrderId);
  return { error: null };
}

export async function failSafetyCheckAction(
  workOrderId: string,
  _prevState: SafetyFormState,
  formData: FormData
): Promise<SafetyFormState> {
  try {
    const description = String(formData.get("recommendation_description") ?? "").trim();
    const severity = String(
      formData.get("recommendation_severity") ?? "immediate_attention"
    ) as RecommendationSeverity;
    const notes = String(formData.get("safety_check_notes") ?? "");
    await failSafetyCheck(workOrderId, {
      notes,
      recommendations: description ? [{ description, severity, notes: null }] : [],
    });
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidateWorkOrder(workOrderId);
  return { error: null };
}

export async function overrideSafetyRequirementAction(
  workOrderId: string,
  _prevState: SafetyFormState,
  formData: FormData
): Promise<SafetyFormState> {
  try {
    const mode = String(formData.get("safety_override") ?? "");
    if (mode === "waive") {
      await overrideSafetyRequirement(workOrderId, { waive: true });
    } else if (mode === "require") {
      await overrideSafetyRequirement(workOrderId, { require: true, waive: false });
    } else if (mode === "default") {
      await overrideSafetyRequirement(workOrderId, { require: false, waive: false });
    } else {
      return { error: "Choose a safety override option." };
    }
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidateWorkOrder(workOrderId);
  return { error: null };
}
