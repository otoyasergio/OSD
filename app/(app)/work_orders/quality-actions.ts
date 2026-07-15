"use server";

import { revalidatePath } from "next/cache";
import { toFormErrorMessage } from "@/lib/services/errors";
import {
  cancelWorkOrder,
  completeQualityCheck,
  completeWorkOrder,
  markReadyForPickup,
  placeWorkOrderOnHold,
  resumeWorkOrderFromHold,
} from "@/lib/services/quality";

export type QualityFormState = { error: string | null };

function revalidateWorkOrder(workOrderId: string) {
  revalidatePath(`/work_orders/${workOrderId}`);
  revalidatePath("/work_orders");
  revalidatePath("/dashboard");
  revalidatePath("/technician");
}

export async function clearAdminFlagAction(
  workOrderId: string,
  _prevState: QualityFormState,
  formData: FormData
): Promise<QualityFormState> {
  try {
    const { clearAdminFlag } = await import("@/lib/services/adminFlags");
    await clearAdminFlag(String(formData.get("admin_flag_id") ?? ""));
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidateWorkOrder(workOrderId);
  revalidatePath("/technician");
  return { error: null };
}

export async function completeQualityCheckAction(
  workOrderId: string,
  _prevState: QualityFormState,
  formData: FormData
): Promise<QualityFormState> {
  try {
    await completeQualityCheck(
      workOrderId,
      String(formData.get("quality_check_notes") ?? "")
    );
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidateWorkOrder(workOrderId);
  return { error: null };
}

export async function markReadyForPickupAction(
  workOrderId: string
): Promise<QualityFormState> {
  try {
    await markReadyForPickup(workOrderId);
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidateWorkOrder(workOrderId);
  return { error: null };
}

export async function completeWorkOrderAction(
  workOrderId: string,
  _prevState: QualityFormState,
  formData: FormData
): Promise<QualityFormState> {
  try {
    await completeWorkOrder(workOrderId, String(formData.get("pickup_notes") ?? ""));
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidateWorkOrder(workOrderId);
  return { error: null };
}

export async function cancelWorkOrderAction(
  workOrderId: string,
  _prevState: QualityFormState,
  formData: FormData
): Promise<QualityFormState> {
  try {
    await cancelWorkOrder(workOrderId, String(formData.get("cancel_reason") ?? ""));
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidateWorkOrder(workOrderId);
  return { error: null };
}

export async function resumeWorkOrderFromHoldAction(
  workOrderId: string
): Promise<QualityFormState> {
  try {
    await resumeWorkOrderFromHold(workOrderId);
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidateWorkOrder(workOrderId);
  return { error: null };
}

export async function placeWorkOrderOnHoldAction(
  workOrderId: string,
  _prevState: QualityFormState,
  formData: FormData
): Promise<QualityFormState> {
  try {
    await placeWorkOrderOnHold(workOrderId, String(formData.get("hold_reason") ?? ""));
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidateWorkOrder(workOrderId);
  return { error: null };
}
