"use server";

import { revalidatePath } from "next/cache";
import { toFormErrorMessage } from "@/lib/services/errors";
import {
  sendReadyForPickupNotice,
  type PickupNoticeSendResult,
} from "@/lib/services/pickupNotice";

export type PickupNoticeActionResult = {
  error: string | null;
  sms: PickupNoticeSendResult["sms"] | null;
  email: PickupNoticeSendResult["email"] | null;
};

export async function sendReadyForPickupNoticeAction(
  workOrderId: string
): Promise<PickupNoticeActionResult> {
  try {
    const result = await sendReadyForPickupNotice(workOrderId);
    revalidatePath(`/work_orders/${workOrderId}`);
    return { error: null, sms: result.sms, email: result.email };
  } catch (error) {
    return {
      error: toFormErrorMessage(error),
      sms: null,
      email: null,
    };
  }
}
