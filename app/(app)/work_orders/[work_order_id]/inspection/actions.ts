"use server";

import { revalidatePath } from "next/cache";
import { completeInspection, saveInspectionResult } from "@/lib/services/inspections";
import { toFormErrorMessage } from "@/lib/services/errors";
import { recordUxFailure } from "@/lib/services/uxEvents";
import type { InspectionResultStatus } from "@/lib/database/types";

export type InspectionFormState = { error: string | null };

function revalidateInspection(workOrderId: string) {
  revalidatePath(`/work_orders/${workOrderId}`);
  revalidatePath(`/work_orders/${workOrderId}/inspection`);
  revalidatePath("/work_orders");
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
    });
  } catch (error) {
    const message = await recordUxFailure(error, {
      source: "inspection.complete",
      context: { work_order_id: workOrderId },
    });
    return { error: message };
  }

  revalidateInspection(workOrderId);
  return { error: null };
}
