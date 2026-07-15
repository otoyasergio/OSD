"use server";

import { revalidatePath } from "next/cache";
import {
  completeInspection,
  ensureInspectionStarted,
  saveInspectionResult,
} from "@/lib/services/inspections";
import { toFormErrorMessage } from "@/lib/services/errors";
import type { InspectionResultStatus } from "@/lib/database/types";

export type InspectionFormState = { error: string | null };

function revalidateInspection(workOrderId: string) {
  revalidatePath(`/work_orders/${workOrderId}`);
  revalidatePath(`/work_orders/${workOrderId}/inspection`);
  revalidatePath("/work_orders");
}

export async function ensureInspectionStartedAction(
  workOrderId: string
): Promise<{ ok: true; started_at: string } | { ok: false; error: string }> {
  try {
    const started_at = await ensureInspectionStarted(workOrderId);
    revalidateInspection(workOrderId);
    return { ok: true, started_at };
  } catch (error) {
    return { ok: false, error: toFormErrorMessage(error) };
  }
}

export async function saveInspectionResultAction(
  workOrderId: string,
  inspectionResultId: string,
  input: {
    status?: InspectionResultStatus | null;
    measurement?: string | null;
    notes?: string | null;
  }
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await saveInspectionResult(inspectionResultId, input);
  } catch (error) {
    return { ok: false, error: toFormErrorMessage(error) };
  }

  revalidateInspection(workOrderId);
  return { ok: true };
}

export async function completeInspectionAction(
  workOrderId: string,
  _prevState: InspectionFormState,
  formData: FormData
): Promise<InspectionFormState> {
  try {
    await completeInspection(workOrderId, {
      force: formData.get("force") === "true",
      technician_signer_name: String(formData.get("technician_signer_name") ?? ""),
      signature_data_url: String(formData.get("signature_data_url") ?? ""),
    });
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidateInspection(workOrderId);
  return { error: null };
}
