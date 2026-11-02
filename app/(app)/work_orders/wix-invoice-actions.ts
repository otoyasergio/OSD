"use server";

import { revalidatePath } from "next/cache";
import {
  acknowledgeInvoiceFailure,
  answerSquareAsk,
  publishWorkOrderInvoice,
  recentTerminalPayments,
  voidAndSquareVisit,
} from "@/lib/services/wixInvoices";
import { toFormErrorMessage } from "@/lib/services/errors";

export async function acknowledgeWixInvoiceFailureFormAction(formData: FormData): Promise<void> {
  const acknowledgementId = String(formData.get("acknowledgement_id") ?? "");
  const holdRevision = Number(formData.get("hold_revision") ?? "");
  const errorText = String(formData.get("wix_error_text") ?? "");
  await acknowledgeInvoiceFailure(acknowledgementId, { holdRevision, errorText });
  revalidatePath("/work_orders");
}

export async function publishWixInvoiceAction(
  workOrderId: string,
  dueDate: string | null
): Promise<{ error: string | null }> {
  try {
    await publishWorkOrderInvoice({ workOrderId, dueDate });
    revalidatePath(`/work_orders/${workOrderId}`);
    revalidatePath("/billing");
    return { error: null };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}

export async function answerSquareAskAction(
  wixPaymentId: string,
  answer: "yes" | "not_yet"
): Promise<{ error: string | null }> {
  try {
    await answerSquareAsk({ wixPaymentId, answer });
    revalidatePath("/billing");
    return { error: null };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}

export async function voidAndSquareAction(
  workOrderId: string,
  input: { squarePaymentId?: string | null; offlineAmountCents?: number | null }
): Promise<{ error: string | null }> {
  try {
    await voidAndSquareVisit({ workOrderId, ...input });
    revalidatePath(`/work_orders/${workOrderId}`);
    revalidatePath("/billing");
    return { error: null };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}

export async function listTerminalPaymentsAction() {
  return recentTerminalPayments();
}
