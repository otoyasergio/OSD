"use server";

import { revalidatePath } from "next/cache";
import {
  cancelAndRecreateSquareInvoice,
  publishWorkOrderSquareBalance,
  publishWorkOrderSquareInvoice,
  sendWorkOrderEstimateApproval,
  syncWorkOrderSquareDraft,
} from "@/lib/services/squareBilling";
import type { BillingAmountMode } from "@/lib/billing/stages";
import { toFormErrorMessage } from "@/lib/services/errors";

function revalidateWo(workOrderId: string) {
  revalidatePath(`/work_orders/${workOrderId}`);
  revalidatePath("/billing");
}

/** @deprecated Prefer publishSquareInvoiceAction */
export async function createSquareInvoiceAction(
  workOrderId: string
): Promise<{ error: string | null; publicUrl?: string | null }> {
  return publishSquareInvoiceAction(workOrderId, { mode: "full" });
}

export async function syncSquareDraftAction(
  workOrderId: string
): Promise<{ error: string | null; publicUrl?: string | null }> {
  try {
    const result = await syncWorkOrderSquareDraft(workOrderId);
    revalidateWo(workOrderId);
    return { error: null, publicUrl: result.public_url };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}

export async function sendEstimateApprovalAction(
  workOrderId: string,
  channel: "sms" | "email" = "email"
): Promise<{ error: string | null; sent?: boolean }> {
  try {
    const result = await sendWorkOrderEstimateApproval(workOrderId, channel);
    revalidateWo(workOrderId);
    return { error: null, sent: result.sent };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}

export async function publishSquareInvoiceAction(
  workOrderId: string,
  input: {
    mode: BillingAmountMode;
    depositPercent?: number;
    customCents?: number;
  }
): Promise<{ error: string | null; publicUrl?: string | null }> {
  try {
    const result = await publishWorkOrderSquareInvoice(workOrderId, input);
    revalidateWo(workOrderId);
    return { error: null, publicUrl: result.public_url };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}

export async function publishSquareBalanceAction(
  workOrderId: string
): Promise<{ error: string | null; publicUrl?: string | null }> {
  try {
    const result = await publishWorkOrderSquareBalance(workOrderId);
    revalidateWo(workOrderId);
    return { error: null, publicUrl: result.public_url };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}

export async function cancelSquareInvoiceAction(
  workOrderId: string
): Promise<{ error: string | null }> {
  try {
    await cancelAndRecreateSquareInvoice(workOrderId);
    revalidateWo(workOrderId);
    return { error: null };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}
