"use server";

import { revalidatePath } from "next/cache";
import { toFormErrorMessage } from "@/lib/services/errors";
import { createWixInvoiceForWorkOrder } from "@/lib/services/wixInvoices";

export type WixInvoiceFormState = {
  error: string | null;
  success: string | null;
};

export async function createWixInvoiceAction(
  workOrderId: string,
  _prev: WixInvoiceFormState,
  formData: FormData
): Promise<WixInvoiceFormState> {
  void formData;
  try {
    const result = await createWixInvoiceForWorkOrder(workOrderId);
    revalidatePath(`/work_orders/${workOrderId}`);
    revalidatePath("/work_orders");
    return {
      error: null,
      success: result.external_invoice_number
        ? `Wix payment link ${result.external_invoice_number} created.`
        : "Wix payment link created.",
    };
  } catch (error) {
    return { error: toFormErrorMessage(error), success: null };
  }
}
