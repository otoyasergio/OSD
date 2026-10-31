import { normalizePhoneE164 } from "@/lib/phone/e164";

export type CustomerMessageChannel = "sms" | "email";

export const WIX_SMS_CHANNEL_GUIDANCE =
  "Wix Contacts is authoritative for SMS subscription. Replies appear only in Wix Inbox.";

export const WIX_SMS_LOCAL_OPT_OUT_WARNING =
  "The local record shows an SMS opt-out. Manage the current subscription in Wix Contacts.";

export function canAttemptCustomerSms(input: {
  phone: string | null | undefined;
  smsOptedOut: boolean;
}): boolean {
  return normalizePhoneE164(input.phone) !== null;
}

export function canAttemptCustomerEmail(email: string | null | undefined): boolean {
  const value = email?.trim() ?? "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
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
