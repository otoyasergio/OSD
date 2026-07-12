"use server";

import { revalidatePath } from "next/cache";
import { createWorkOrderSquareInvoice } from "@/lib/services/squareBilling";
import { toFormErrorMessage } from "@/lib/services/errors";

export async function createSquareInvoiceAction(
  workOrderId: string
): Promise<{ error: string | null; publicUrl?: string | null }> {
  try {
    const result = await createWorkOrderSquareInvoice(workOrderId);
    revalidatePath(`/work_orders/${workOrderId}`);
    return { error: null, publicUrl: result.public_url };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}
