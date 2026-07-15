"use server";

import { revalidatePath } from "next/cache";
import { toFormErrorMessage } from "@/lib/services/errors";
import { moveWorkOrderOnBoard } from "@/lib/services/workOrderTransitions";

export type BoardMoveResult = { error: string | null };

export async function moveWorkOrderOnBoardAction(
  workOrderId: string,
  targetColumnId: string
): Promise<BoardMoveResult> {
  try {
    await moveWorkOrderOnBoard(workOrderId, targetColumnId);
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidatePath("/dashboard");
  revalidatePath("/control-center");
  revalidatePath("/work_orders");
  revalidatePath(`/work_orders/${workOrderId}`);
  revalidatePath("/technician");
  return { error: null };
}
