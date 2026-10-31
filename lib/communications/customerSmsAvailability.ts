import { normalizePhoneE164 } from "@/lib/phone/e164";

export type CustomerMessageChannel = "sms" | "email";

export const WIX_SMS_LOCAL_OPT_OUT_WARNING =
  "The local record shows an SMS opt-out. Wix Inbox will check the customer’s current Wix Contacts subscription before sending.";

export function canAttemptCustomerSms(input: {
  phone: string | null | undefined;
  smsOptedOut: boolean;
}): boolean {
  return normalizePhoneE164(input.phone) !== null;
}

export function deriveCustomerMessageChannel(input: {
  preferredChannel: CustomerMessageChannel;
  smsAvailable: boolean;
  emailAvailable: boolean;
}): CustomerMessageChannel | null {
  const { preferredChannel, smsAvailable, emailAvailable } = input;
  if (preferredChannel === "sms" && smsAvailable) return "sms";
  if (preferredChannel === "email" && emailAvailable) return "email";
  if (smsAvailable) return "sms";
  if (emailAvailable) return "email";
  return null;
}
