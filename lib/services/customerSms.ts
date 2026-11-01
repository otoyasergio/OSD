import { createClient } from "@/lib/database/supabase-server";
import { normalizePhoneE164 } from "@/lib/phone/e164";
import { syncCustomerToWix } from "@/lib/services/wixContacts";
import { getWixContactV5, type WixContactV5SmsDetails } from "@/lib/wix/client";
import { isWixInboxSmsConfigured } from "@/lib/wix/config";
import { sendWixInboxSms } from "@/lib/wix/inbox";

export type SendCustomerSmsInput = {
  customerId: string;
  wixContactId: string | null;
  to: string | null;
  body: string;
  localOptedOutAt: string | null;
};

async function syncContact(customerId: string): Promise<string> {
  const customer = await syncCustomerToWix(customerId);
  if (!customer.wix_contact_id) throw new Error("WIX_CONTACT_SYNC_FAILED");
  return customer.wix_contact_id;
}

async function updateLocalOptOut(
  customerId: string,
  smsOptedOutAt: string | null
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("customer")
    .update({ sms_opted_out_at: smsOptedOutAt })
    .eq("customer_id", customerId);
  if (error) throw error;
}

function remotePhone(contact: WixContactV5SmsDetails): string | null {
  return normalizePhoneE164(contact.phone?.e164);
}

export async function sendCustomerSms(input: SendCustomerSmsInput): Promise<string> {
  if (!isWixInboxSmsConfigured()) throw new Error("WIX_INBOX_SMS_NOT_CONFIGURED");

  const recipient = normalizePhoneE164(input.to);
  if (!recipient) throw new Error("INVALID_PHONE");

  let contactId = input.wixContactId?.trim() || null;
  let didSync = false;
  if (!contactId) {
    contactId = await syncContact(input.customerId);
    didSync = true;
  }

  let contact: WixContactV5SmsDetails;
  try {
    contact = await getWixContactV5(contactId);
  } catch (error) {
    if (
      didSync ||
      !(error instanceof Error) ||
      error.message !== "WIX_CONTACT_NOT_FOUND"
    ) {
      throw error;
    }
    contactId = await syncContact(input.customerId);
    didSync = true;
    contact = await getWixContactV5(contactId);
  }
  let wixPhone = remotePhone(contact);
  if (!wixPhone) throw new Error("WIX_SMS_PHONE_INVALID");

  if (wixPhone !== recipient && !didSync) {
    contactId = await syncContact(input.customerId);
    didSync = true;
    contact = await getWixContactV5(contactId);
    wixPhone = remotePhone(contact);
  }

  if (!wixPhone) throw new Error("WIX_SMS_PHONE_INVALID");
  if (wixPhone !== recipient) throw new Error("WIX_SMS_PHONE_MISMATCH");

  const subscription = contact.phone?.subscriptionStatus;
  switch (subscription?.status) {
    case "UNSUBSCRIBED":
      if (!input.localOptedOutAt) {
        await updateLocalOptOut(
          input.customerId,
          subscription.updatedDate ?? contact.updatedDate ?? new Date().toISOString()
        );
      }
      throw new Error("SMS_OPTED_OUT");
    case "SUBSCRIBED":
      if (input.localOptedOutAt) {
        await updateLocalOptOut(input.customerId, null);
      }
      break;
    case "NOT_SET":
    case "PENDING":
      if (input.localOptedOutAt) throw new Error("SMS_OPTED_OUT");
      break;
    case "NO_SUBSCRIPTION_STATUS":
    default:
      throw new Error("WIX_SMS_SUBSCRIPTION_REQUIRED");
  }

  if (contact.phone?.deliverabilityStatus === "INVALID") {
    throw new Error("WIX_SMS_UNDELIVERABLE");
  }

  const result = await sendWixInboxSms({ contactId, body: input.body });
  return result.messageId;
}
