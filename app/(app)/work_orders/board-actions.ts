"use server";

import { revalidatePath } from "next/cache";
import { moveWorkOrderOnBoard } from "@/lib/services/workOrderTransitions";
import { recordUxFailure } from "@/lib/services/uxEvents";

export type BoardMoveResult = { error: string | null };

export async function moveWorkOrderOnBoardAction(
  workOrderId: string,
  targetColumnId: string
): Promise<BoardMoveResult> {
  try {
    await moveWorkOrderOnBoard(workOrderId, targetColumnId);
  } catch (error) {
    return {
      error: await recordUxFailure(error, {
        source: "board.move",
        context: { work_order_id: workOrderId, target_column_id: targetColumnId },
      }),
    };
  }

  revalidatePath("/dashboard");
  revalidatePath("/control-center");
  revalidatePath("/work_orders");
  revalidatePath(`/work_orders/${workOrderId}`);
  revalidatePath("/technician");
  return { error: null };
}
