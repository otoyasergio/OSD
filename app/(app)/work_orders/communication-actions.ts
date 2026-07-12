"use server";

import { revalidatePath } from "next/cache";
import { sendWorkOrderMessage } from "@/lib/services/communications";
import { toFormErrorMessage } from "@/lib/services/errors";

export async function sendMessageAction(
  workOrderId: string,
  templateKey: "approval_request" | "ready_for_pickup" | "contract_link" | "payment_reminder",
  channel: "sms" | "email"
): Promise<{ error: string | null }> {
  try {
    await sendWorkOrderMessage({
      work_order_id: workOrderId,
      template_key: templateKey,
      channel,
    });
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidatePath(`/work_orders/${workOrderId}`);
  return { error: null };
}
