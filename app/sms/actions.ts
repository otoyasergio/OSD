"use server";

import { createAdminClient } from "@/lib/database/supabase-admin";
import { applySmsConsent } from "@/lib/services/smsConsent";
import { toFormErrorMessage } from "@/lib/services/errors";
import { validateSmsSubscribeInput } from "@/lib/sms/subscribeValidation";
import { normalizePhoneE164 } from "@/lib/twilio/phone";

export type SmsSubscribeState = {
  error: string | null;
  success: boolean;
};

function phoneLast10(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.slice(-10);
}

async function findOrCreateCustomerByPhone(e164: string): Promise<string> {
  const admin = createAdminClient();
  const last10 = phoneLast10(e164);

  const { data: candidates, error } = await admin
    .from("customer")
    .select("customer_id, phone")
    .not("phone", "is", null)
    .ilike("phone", `%${last10}`);

  if (error) throw error;

  const match = (candidates ?? []).find(
    (row) => row.phone && phoneLast10(row.phone) === last10
  );
  if (match) return match.customer_id;

  const { data: created, error: insertError } = await admin
    .from("customer")
    .insert({
      first_name: "SMS",
      last_name: "Subscriber",
      phone: e164,
    })
    .select("customer_id")
    .single();

  if (insertError) throw insertError;
  return created.customer_id;
}

export async function subscribeSmsAction(
  _prevState: SmsSubscribeState,
  formData: FormData
): Promise<SmsSubscribeState> {
  const phone = String(formData.get("phone") ?? "");
  const transactional = formData.get("sms_transactional") === "on";
  const marketing = formData.get("sms_marketing") === "on";

  const validation = validateSmsSubscribeInput({ phone, transactional, marketing });
  if (!validation.ok) {
    return { error: validation.error, success: false };
  }

  const e164 = normalizePhoneE164(phone);
  if (!e164) {
    return { error: "Enter a valid phone number.", success: false };
  }

  try {
    const customerId = await findOrCreateCustomerByPhone(e164);
    await applySmsConsent({
      customerId,
      transactional,
      marketing,
      method: "web_form",
      sourcePath: "/sms",
      sendWelcome: true,
      phoneForWelcome: e164,
    });
    return { error: null, success: true };
  } catch (error) {
    return { error: toFormErrorMessage(error), success: false };
  }
}
