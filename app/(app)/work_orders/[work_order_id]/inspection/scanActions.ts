"use server";

import { revalidatePath } from "next/cache";
import { toFormErrorMessage } from "@/lib/services/errors";
import {
  chooseInspectionMileage,
  confirmInspectionScan,
  inspectionScanReading,
  markInspectionNoConnection,
  pasteInspectionScan,
  type InspectionScanReading,
} from "@/lib/services/inspectionScans";

export type ScanFormState = { error: string | null };

function revalidateInspection(workOrderId: string) {
  revalidatePath(`/work_orders/${workOrderId}`);
  revalidatePath(`/work_orders/${workOrderId}/inspection`);
}

function failure(error: unknown): ScanFormState {
  return { error: toFormErrorMessage(error) };
}

export async function loadInspectionScanAction(
  workOrderId: string
): Promise<InspectionScanReading | null> {
  try {
    return await inspectionScanReading(workOrderId);
  } catch {
    return null;
  }
}

export async function pasteInspectionScanAction(
  workOrderId: string,
  _prev: ScanFormState,
  formData: FormData
): Promise<ScanFormState> {
  try {
    await pasteInspectionScan(workOrderId, String(formData.get("report_text") ?? ""));
  } catch (error) {
    return failure(error);
  }
  revalidateInspection(workOrderId);
  return { error: null };
}

export async function markInspectionNoConnectionAction(
  workOrderId: string,
  _prev: ScanFormState,
  _formData: FormData
): Promise<ScanFormState> {
  try {
    await markInspectionNoConnection(workOrderId);
  } catch (error) {
    return failure(error);
  }
  revalidateInspection(workOrderId);
  return { error: null };
}

export async function confirmInspectionScanAction(
  workOrderId: string,
  _prev: ScanFormState,
  formData: FormData
): Promise<ScanFormState> {
  const outcome = String(formData.get("outcome") ?? "");
  if (outcome !== "codes" && outcome !== "no_codes" && outcome !== "no_connection") {
    return { error: "Choose what the scan showed." };
  }
  try {
    await confirmInspectionScan(
      workOrderId,
      String(formData.get("scan_report_id") ?? ""),
      outcome
    );
  } catch (error) {
    return failure(error);
  }
  revalidateInspection(workOrderId);
  return { error: null };
}

export async function chooseInspectionMileageAction(
  workOrderId: string,
  _prev: ScanFormState,
  formData: FormData
): Promise<ScanFormState> {
  const choice = String(formData.get("choice") ?? "");
  if (choice !== "report" && choice !== "keep") {
    return { error: "Choose which mileage to keep." };
  }
  try {
    await chooseInspectionMileage(
      workOrderId,
      String(formData.get("scan_report_id") ?? ""),
      choice
    );
  } catch (error) {
    return failure(error);
  }
  revalidateInspection(workOrderId);
  return { error: null };
}
