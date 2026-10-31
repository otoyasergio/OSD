import { normalizePhoneE164 } from "@/lib/phone/e164";

export const WIX_SMS_LOCAL_OPT_OUT_WARNING =
  "The local record shows an SMS opt-out. Wix Inbox will check the customer’s current Wix Contacts subscription before sending.";

export function canAttemptCustomerSms(input: {
  phone: string | null | undefined;
  smsOptedOut: boolean;
}): boolean {
  return normalizePhoneE164(input.phone) !== null;
}
