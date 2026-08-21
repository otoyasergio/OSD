"use server";

import { toFormErrorMessage } from "@/lib/services/errors";
import { recordUxEvent } from "@/lib/services/uxEvents";

export type SubmitUxLogState = {
  error: string | null;
  ok?: boolean;
};

export async function submitUxLogAction(input: {
  message: string;
  source?: string;
  note?: string;
  code?: string;
  workOrderId?: string;
}): Promise<SubmitUxLogState> {
  const message = input.message.trim();
  if (!message) {
    return { error: "Nothing to report." };
  }

  const note = input.note?.trim() || "";
  try {
    await recordUxEvent({
      event_type: "friction",
      code: (input.code?.trim() || "USER_SUBMITTED_ERROR").slice(0, 120),
      message: message.slice(0, 500),
      source: (input.source?.trim() || "user.submit_log").slice(0, 200),
      context: {
        user_submitted: true,
        ...(note ? { user_note: note.slice(0, 500) } : {}),
        ...(input.workOrderId ? { work_order_id: input.workOrderId } : {}),
      },
      throwOnError: true,
    });
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  return { error: null, ok: true };
}
