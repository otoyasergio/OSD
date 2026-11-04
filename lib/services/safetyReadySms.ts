import type { DbClient } from "@/lib/database/types";
import { PEDRAM_SAFETY_PHONE, safetyReadyMessage } from "@/lib/status/safetyReadyText";
import { createWixContact, findWixContactByEmailOrPhone } from "@/lib/wix/client";
import { isWixInboxSmsConfigured } from "@/lib/wix/config";
import { sendWixInboxSms } from "@/lib/wix/inbox";

async function pedramContactId(): Promise<string> {
  const existing = await findWixContactByEmailOrPhone({ phone: PEDRAM_SAFETY_PHONE });
  if (existing?.id) return existing.id;
  const created = await createWixContact({
    firstName: "Pedram",
    lastName: "Safety",
    phone: PEDRAM_SAFETY_PHONE,
  });
  return created.id;
}

/**
 * Text Pedram through Wix Inbox. Does not create a shop customer and does not
 * use the customer opt-out path. A failure is reported to the caller.
 */
export async function sendSafetyReadyText(
  supabase: DbClient,
  workOrderId: string
): Promise<void> {
  if (!isWixInboxSmsConfigured()) throw new Error("WIX_INBOX_SMS_NOT_CONFIGURED");

  const { data: workOrder, error: workOrderError } = await supabase
    .from("work_order")
    .select("motorcycle_id")
    .eq("work_order_id", workOrderId)
    .maybeSingle();
  if (workOrderError) throw workOrderError;
  if (!workOrder?.motorcycle_id) throw new Error("MOTORCYCLE_NOT_FOUND");

  const { data: motorcycle, error: motorcycleError } = await supabase
    .from("motorcycle")
    .select("make, year, model, vin")
    .eq("motorcycle_id", workOrder.motorcycle_id)
    .maybeSingle();
  if (motorcycleError) throw motorcycleError;
  if (!motorcycle) throw new Error("MOTORCYCLE_NOT_FOUND");

  const contactId = await pedramContactId();
  await sendWixInboxSms({
    contactId,
    body: safetyReadyMessage(motorcycle),
  });
}
