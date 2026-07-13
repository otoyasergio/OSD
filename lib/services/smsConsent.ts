import { createAdminClient } from "@/lib/database/supabase-admin";
import { sendSms, isTwilioConfigured } from "@/lib/twilio/client";
import { normalizePhoneE164 } from "@/lib/twilio/phone";
import { buildOptInConfirmation, type SmsProgram } from "@/lib/sms/consentPolicy";

export type ConsentMethod = "web_form" | "staff" | "portal" | "inbound_sms";

export type ApplySmsConsentInput = {
  customerId: string;
  transactional: boolean;
  marketing: boolean;
  method: ConsentMethod;
  sourcePath?: string;
  actorUserId?: string | null;
  sendWelcome?: boolean;
  phoneForWelcome?: string | null;
};

/**
 * Sets sms_consent_source (ends soft rollout), updates consent timestamps,
 * writes audit rows for transitions, optionally sends welcome SMS.
 */
export async function applySmsConsent(input: ApplySmsConsentInput): Promise<void> {
  const admin = createAdminClient();
  const now = new Date().toISOString();

  const { data: existing, error } = await admin
    .from("customer")
    .select(
      "customer_id, phone, sms_transactional_consent_at, sms_marketing_consent_at, sms_opted_out_at"
    )
    .eq("customer_id", input.customerId)
    .single();
  if (error) throw error;

  const hadTxn = Boolean(existing.sms_transactional_consent_at);
  const hadMkt = Boolean(existing.sms_marketing_consent_at);
  const programsGained: SmsProgram[] = [];

  const patch = {
    sms_consent_source: input.method,
    sms_transactional_consent_at: input.transactional
      ? (existing.sms_transactional_consent_at ?? now)
      : null,
    sms_marketing_consent_at: input.marketing
      ? (existing.sms_marketing_consent_at ?? now)
      : null,
  };

  if (input.transactional && !hadTxn) programsGained.push("transactional");
  if (input.marketing && !hadMkt) programsGained.push("marketing");

  const { error: upErr } = await admin
    .from("customer")
    .update(patch)
    .eq("customer_id", input.customerId);
  if (upErr) throw upErr;

  const events: Array<{
    customer_id: string;
    program: "transactional" | "marketing";
    action: "opt_in" | "opt_out";
    method: ConsentMethod;
    source_path: string | null;
    actor_user_id: string | null;
  }> = [];

  if (input.transactional && !hadTxn) {
    events.push({
      customer_id: input.customerId,
      program: "transactional",
      action: "opt_in",
      method: input.method,
      source_path: input.sourcePath ?? null,
      actor_user_id: input.actorUserId ?? null,
    });
  } else if (!input.transactional && hadTxn) {
    events.push({
      customer_id: input.customerId,
      program: "transactional",
      action: "opt_out",
      method: input.method,
      source_path: input.sourcePath ?? null,
      actor_user_id: input.actorUserId ?? null,
    });
  }

  if (input.marketing && !hadMkt) {
    events.push({
      customer_id: input.customerId,
      program: "marketing",
      action: "opt_in",
      method: input.method,
      source_path: input.sourcePath ?? null,
      actor_user_id: input.actorUserId ?? null,
    });
  } else if (!input.marketing && hadMkt) {
    events.push({
      customer_id: input.customerId,
      program: "marketing",
      action: "opt_out",
      method: input.method,
      source_path: input.sourcePath ?? null,
      actor_user_id: input.actorUserId ?? null,
    });
  }

  if (events.length > 0) {
    const { error: evErr } = await admin.from("sms_consent_event").insert(events);
    if (evErr) throw evErr;
  }

  if (
    input.sendWelcome &&
    programsGained.length > 0 &&
    isTwilioConfigured() &&
    !existing.sms_opted_out_at
  ) {
    const phone = normalizePhoneE164(input.phoneForWelcome ?? existing.phone ?? "");
    if (phone) {
      try {
        await sendSms({
          to: phone,
          body: buildOptInConfirmation(programsGained),
        });
      } catch {
        // Consent is already persisted; welcome SMS failure must not roll back.
      }
    }
  }
}
