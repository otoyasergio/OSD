"use server";

import { revalidatePath } from "next/cache";
import { toFormErrorMessage } from "@/lib/services/errors";
import {
  loadStorageChecklist,
  updateStorageTerms,
  type StorageChecklistSnapshot,
} from "@/lib/services/storageChecklist";
import { moveWorkOrderOnBoard } from "@/lib/services/workOrderTransitions";
import { recordUxFailure } from "@/lib/services/uxEvents";

export async function loadStorageChecklistAction(workOrderId: string): Promise<{
  error: string | null;
  checklist: StorageChecklistSnapshot | null;
}> {
  try {
    const checklist = await loadStorageChecklist(workOrderId);
    return { error: null, checklist };
  } catch (error) {
    return {
      error: await recordUxFailure(error, {
        source: "storage.checklist",
        context: { work_order_id: workOrderId },
      }),
      checklist: null,
    };
  }
}

export async function placeBikeInStorageAction(input: {
  workOrderId: string;
  targetColumnId: string;
  pickupBy: string;
  monthlyCents: number;
}): Promise<{ error: string | null }> {
  try {
    await moveWorkOrderOnBoard(input.workOrderId, input.targetColumnId, {
      pickupBy: input.pickupBy,
      monthlyCents: input.monthlyCents,
    });
  } catch (error) {
    return {
      error: await recordUxFailure(error, {
        source: "storage.place",
        context: {
          work_order_id: input.workOrderId,
          target_column_id: input.targetColumnId,
        },
      }),
    };
  }
  revalidatePath("/dashboard");
  revalidatePath("/control-center");
  revalidatePath("/work_orders");
  revalidatePath(`/work_orders/${input.workOrderId}`);
  return { error: null };
}

export async function updateStorageTermsAction(input: {
  workOrderId: string;
  pickupBy: string;
  monthlyAmount: string;
}): Promise<{ error: string | null }> {
  try {
    await updateStorageTerms(input);
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidatePath("/dashboard");
  revalidatePath("/control-center");
  revalidatePath(`/work_orders/${input.workOrderId}`);
  return { error: null };
}
