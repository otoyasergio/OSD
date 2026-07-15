"use server";

import { revalidatePath } from "next/cache";
import { sendWorkOrderMessage } from "@/lib/services/communications";
import { toFormErrorMessage } from "@/lib/services/errors";
import { sendMessageSchema } from "@/lib/validation/schemas";

export async function sendMessageAction(
  workOrderId: string,
  templateKey: string,
  channel: string
): Promise<{ error: string | null }> {
  try {
    const parsed = sendMessageSchema.parse({
      template_key: templateKey,
      channel,
    });
    await sendWorkOrderMessage({
      work_order_id: workOrderId,
      template_key: parsed.template_key,
      channel: parsed.channel,
    });
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidatePath(`/work_orders/${workOrderId}`);
  return { error: null };
}
