import { clientDisplayName } from "@/lib/customers/displayName";
import { normalizePhoneE164 } from "@/lib/phone/e164";
import { TORONTO_SHOP } from "@/lib/shop/toronto";
import { isPickupBoardColumn } from "@/lib/status/transitions";

export type PickupNoticeBlocker = "location" | "sms_opt_out" | "phone" | "email";

export type PickupNoticeContact = {
  workOrderId: string;
  customerName: string;
  phone: string | null;
  email: string | null;
  smsOptedOut: boolean;
};

export const PICKUP_NOTICE_BLOCKER_COPY: Record<PickupNoticeBlocker, string> = {
  location: "Pickup notices with the Toronto address are only sent for the Toronto shop.",
  sms_opt_out: "This customer opted out of SMS.",
  phone: "This customer has no mobile number that can receive a text.",
  email: "This customer has no email on file.",
};

/** Ask only after a drop onto Ready actually saved. */
export function shouldPromptPickupNotice(input: {
  targetColumnId: string;
  moveSucceeded: boolean;
}): boolean {
  return input.moveSucceeded && isPickupBoardColumn(input.targetColumnId);
}

export function pickupNoticeBlockers(input: {
  phone: string | null;
  email: string | null;
  smsOptedOut: boolean;
  locationCode: string | null;
}): PickupNoticeBlocker[] {
  const blockers: PickupNoticeBlocker[] = [];
  const locationCode = input.locationCode?.trim().toUpperCase() ?? "";
  if (locationCode !== TORONTO_SHOP.locationCode) blockers.push("location");
  if (!normalizePhoneE164(input.phone)) blockers.push("phone");
  if (!input.email?.trim()) blockers.push("email");
  return blockers;
}

export function canSendPickupNotice(input: {
  phone: string | null;
  email: string | null;
  smsOptedOut: boolean;
  locationCode: string | null;
}): boolean {
  return pickupNoticeBlockers(input).length === 0;
}

export function pickupNoticePromptBody(customerName: string): string {
  return `Text and email ${customerName} that their motorcycle is ready at ${TORONTO_SHOP.streetAddress}. Hours: ${TORONTO_SHOP.hours}, ${TORONTO_SHOP.sunday}.`;
}

export function pickupNoticeContact(input: {
  workOrderId: string;
  customerName?: string | null;
  phone?: string | null;
  email?: string | null;
  smsOptedOut?: boolean;
}): PickupNoticeContact {
  const name = input.customerName?.replace(/\s+/g, " ").trim();
  return {
    workOrderId: input.workOrderId,
    customerName: name || "the customer",
    phone: input.phone?.trim() || null,
    email: input.email?.trim() || null,
    smsOptedOut: Boolean(input.smsOptedOut),
  };
}

export function pickupNoticeFromShopCard(card: {
  work_order_id: string;
  motorcycle: {
    customer: {
      first_name?: string | null;
      last_name?: string | null;
      phone?: string | null;
      email?: string | null;
      sms_opted_out_at?: string | null;
    } | null;
  } | null;
}): PickupNoticeContact {
  const customer = card.motorcycle?.customer ?? null;
  return pickupNoticeContact({
    workOrderId: card.work_order_id,
    customerName: clientDisplayName(customer),
    phone: customer?.phone,
    email: customer?.email,
    smsOptedOut: Boolean(customer?.sms_opted_out_at),
  });
}

export function pickupNoticeFromBoardBike(
  bike: {
    customer_name?: string | null;
    customer_phone?: string | null;
    customer_email?: string | null;
    customer_sms_opted_out?: boolean;
  } | null,
  workOrderId: string
): PickupNoticeContact {
  return pickupNoticeContact({
    workOrderId,
    customerName: bike?.customer_name,
    phone: bike?.customer_phone,
    email: bike?.customer_email,
    smsOptedOut: bike?.customer_sms_opted_out,
  });
}
