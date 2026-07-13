import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { createAdminClient } from "@/lib/database/supabase-admin";
import { addTimelineEvent } from "@/lib/timeline/addTimelineEvent";
import { TimelineEventType } from "@/lib/timeline/events";
import { canRecordCustomerApproval } from "@/lib/permissions";
import { sendSms, isTwilioConfigured } from "@/lib/twilio/client";
import { normalizePhoneE164 } from "@/lib/twilio/phone";
import {
  canSendTransactionalSms,
  classifyInboundSmsKeyword,
  buildHelpReply,
  buildOptOutReply,
} from "@/lib/sms/consentPolicy";
import { sendEmail, isEmailConfigured } from "@/lib/email/send";
import { portalUrl } from "@/lib/portal/tokens";
import { createPortalToken } from "@/lib/services/portal";

export type CommunicationLogEntry = {
  log_id: string;
  channel: "sms" | "email";
  direction: "outbound" | "inbound";
  to_address: string;
  body: string;
  status: string;
  template_key: string | null;
  created_at: string;
};

type TemplateContext = {
  customerName: string;
  workOrderNumber: string;
  portalLink?: string;
  shopName?: string;
};

/** CASL / A2P campaign alignment — Twilio Advanced Opt-Out still owns carrier STOP. */
const SMS_OPT_OUT_FOOTER = "Reply STOP to opt out.";

function withSmsOptOut(body: string): string {
  return `${body.trim()} ${SMS_OPT_OUT_FOOTER}`;
}

const TEMPLATES: Record<
  string,
  {
    sms: (ctx: TemplateContext) => string;
    emailSubject: (ctx: TemplateContext) => string;
    emailHtml: (ctx: TemplateContext) => string;
  }
> = {
  approval_request: {
    sms: (ctx) =>
      withSmsOptOut(
        `Hi ${ctx.customerName}, Toronto Moto needs your approval for work on ${ctx.workOrderNumber}. Review & approve: ${ctx.portalLink ?? ""}`
      ),
    emailSubject: (ctx) => `Approval needed — ${ctx.workOrderNumber}`,
    emailHtml: (ctx) =>
      `<p>Hi ${ctx.customerName},</p><p>We need your approval for recommended work on <strong>${ctx.workOrderNumber}</strong>.</p><p><a href="${ctx.portalLink}">Review and approve online</a></p><p>— Toronto Moto</p>`,
  },
  ready_for_pickup: {
    sms: (ctx) =>
      withSmsOptOut(
        `${ctx.workOrderNumber} is ready for pickup at Toronto Moto. Pay online: ${ctx.portalLink ?? "call us to arrange pickup"}`
      ),
    emailSubject: (ctx) => `Ready for pickup — ${ctx.workOrderNumber}`,
    emailHtml: (ctx) =>
      `<p>Hi ${ctx.customerName},</p><p>Your motorcycle (${ctx.workOrderNumber}) is ready for pickup.</p><p><a href="${ctx.portalLink}">Pay online</a></p><p>— Toronto Moto</p>`,
  },
  contract_link: {
    sms: (ctx) =>
      withSmsOptOut(
        `Please review and sign the drop-off agreement for ${ctx.workOrderNumber}: ${ctx.portalLink ?? ""}`
      ),
    emailSubject: (ctx) => `Sign drop-off agreement — ${ctx.workOrderNumber}`,
    emailHtml: (ctx) =>
      `<p>Hi ${ctx.customerName},</p><p>Please sign the drop-off agreement for <strong>${ctx.workOrderNumber}</strong>.</p><p><a href="${ctx.portalLink}">Sign agreement</a></p>`,
  },
  payment_reminder: {
    sms: (ctx) =>
      withSmsOptOut(
        `Reminder: invoice for ${ctx.workOrderNumber} is outstanding. Pay here: ${ctx.portalLink ?? ""}`
      ),
    emailSubject: (ctx) => `Payment reminder — ${ctx.workOrderNumber}`,
    emailHtml: (ctx) =>
      `<p>Hi ${ctx.customerName},</p><p>Your invoice for ${ctx.workOrderNumber} is still outstanding.</p><p><a href="${ctx.portalLink}">Pay now</a></p>`,
  },
};

export async function listCommunicationLog(
  workOrderId: string
): Promise<CommunicationLogEntry[]> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("communication_log")
    .select(
      "log_id, channel, direction, to_address, body, status, template_key, created_at"
    )
    .eq("work_order_id", workOrderId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw error;
  return (data ?? []) as CommunicationLogEntry[];
}

export async function sendWorkOrderMessage(input: {
  work_order_id: string;
  template_key: keyof typeof TEMPLATES;
  channel: "sms" | "email";
}): Promise<CommunicationLogEntry> {
  const user = await requireUser();
  if (!canRecordCustomerApproval(user.role)) throw new Error("FORBIDDEN");

  const template = TEMPLATES[input.template_key];
  if (!template) throw new Error("MESSAGE_TEMPLATE_NOT_FOUND");

  const supabase = await createClient();
  const { data: wo, error } = await supabase
    .from("work_order")
    .select(
      `
      work_order_id,
      work_order_number,
      location_id,
      customer:customer_id ( customer_id, first_name, last_name, phone, email, sms_opted_out_at, sms_transactional_consent_at, sms_marketing_consent_at, sms_consent_source )
    `
    )
    .eq("work_order_id", input.work_order_id)
    .maybeSingle();

  if (error) throw error;
  if (!wo) throw new Error("WORK_ORDER_NOT_FOUND");
  if (wo.location_id !== user.active_location_id) throw new Error("FOREIGN_LOCATION");

  const customer = wo.customer as unknown as {
    customer_id: string;
    first_name: string;
    last_name: string;
    phone: string | null;
    email: string | null;
    sms_opted_out_at: string | null;
    sms_transactional_consent_at: string | null;
    sms_marketing_consent_at: string | null;
    sms_consent_source: string | null;
  };

  const { token } = await createPortalToken({
    workOrderId: input.work_order_id,
    purpose: input.template_key === "payment_reminder" ? "payment" : "full",
    expiresInDays: 14,
  });

  const ctx: TemplateContext = {
    customerName: customer.first_name,
    workOrderNumber: wo.work_order_number,
    portalLink: portalUrl(token),
    shopName: "Toronto Moto",
  };

  let toAddress = "";
  let externalId: string | null = null;
  let status: CommunicationLogEntry["status"] = "sent";
  let body = "";
  let errorMessage: string | null = null;

  try {
    if (input.channel === "sms") {
      if (!isTwilioConfigured()) throw new Error("TWILIO_NOT_CONFIGURED");
      if (!canSendTransactionalSms(customer)) {
        throw new Error(
          customer.sms_opted_out_at ? "SMS_OPTED_OUT" : "SMS_TRANSACTIONAL_NOT_CONSENTED"
        );
      }
      if (!customer.phone?.trim()) throw new Error("CUSTOMER_PHONE_REQUIRED");
      const e164 = normalizePhoneE164(customer.phone);
      if (!e164) throw new Error("INVALID_PHONE");
      toAddress = e164;
      body = template.sms(ctx);
      const result = await sendSms({ to: toAddress, body });
      externalId = result.sid;
    } else {
      if (!isEmailConfigured()) throw new Error("EMAIL_NOT_CONFIGURED");
      if (!customer.email?.trim()) throw new Error("CUSTOMER_EMAIL_REQUIRED");
      toAddress = customer.email.trim();
      body = template.emailHtml(ctx);
      const result = await sendEmail({
        to: toAddress,
        subject: template.emailSubject(ctx),
        html: body,
        text: template.sms(ctx),
      });
      externalId = result.id;
    }
  } catch (err) {
    status = "failed";
    errorMessage = err instanceof Error ? err.message : "SEND_FAILED";
    body = template.sms(ctx);
    toAddress =
      input.channel === "sms"
        ? (normalizePhoneE164(customer.phone) ?? customer.phone ?? "")
        : (customer.email ?? "");
  }

  const { data: log, error: logError } = await supabase
    .from("communication_log")
    .insert({
      work_order_id: input.work_order_id,
      customer_id: customer.customer_id,
      channel: input.channel,
      direction: "outbound",
      template_key: input.template_key,
      to_address: toAddress,
      body,
      status,
      external_id: externalId,
      error_message: errorMessage,
      sent_by_user_id: user.user_id,
    })
    .select(
      "log_id, channel, direction, to_address, body, status, template_key, created_at"
    )
    .single();

  if (logError) throw logError;

  if (status === "sent") {
    await addTimelineEvent(supabase, {
      work_order_id: input.work_order_id,
      user_id: user.user_id,
      event_type: TimelineEventType.MESSAGE_SENT,
      entity_type: "communication_log",
      entity_id: log.log_id,
      description: `${input.channel.toUpperCase()} sent (${input.template_key})`,
      new_value: { channel: input.channel, template_key: input.template_key },
    });
  }

  if (status === "failed") throw new Error(errorMessage ?? "SEND_FAILED");

  return log as CommunicationLogEntry;
}

export async function handleInboundSms(input: {
  from: string;
  body: string;
}): Promise<string | null> {
  const admin = createAdminClient();
  const normalizedBody = input.body.trim().toUpperCase();
  const keywordKind = classifyInboundSmsKeyword(input.body);

  const { data: customers } = await admin
    .from("customer")
    .select("customer_id, phone, sms_opted_out_at")
    .not("phone", "is", null);

  const customer = (customers ?? []).find((c) => {
    const phone = String(c.phone ?? "").replace(/\D/g, "");
    const from = input.from.replace(/\D/g, "");
    return phone.endsWith(from.slice(-10)) || from.endsWith(phone.slice(-10));
  });

  await admin.from("communication_log").insert({
    customer_id: customer?.customer_id ?? null,
    channel: "sms",
    direction: "inbound",
    to_address: input.from,
    from_address: input.from,
    body: input.body,
    status: "received",
  });

  if (!customer) return null;

  if (keywordKind === "opt_out") {
    await admin
      .from("customer")
      .update({ sms_opted_out_at: new Date().toISOString() })
      .eq("customer_id", customer.customer_id);
    await admin.from("sms_consent_event").insert({
      customer_id: customer.customer_id,
      program: "all",
      action: "opt_out",
      method: "inbound_sms",
    });
    return buildOptOutReply();
  }

  if (keywordKind === "help") {
    return buildHelpReply();
  }

  if (keywordKind === "opt_in_clear") {
    await admin
      .from("customer")
      .update({ sms_opted_out_at: null })
      .eq("customer_id", customer.customer_id);
    return null;
  }

  const { data: openJobs } = await admin
    .from("job")
    .select("job_id, work_order_id, status")
    .eq("status", "waiting_for_approval")
    .in(
      "work_order_id",
      (
        await admin
          .from("work_order")
          .select("work_order_id")
          .eq("customer_id", customer.customer_id)
      ).data?.map((w) => w.work_order_id) ?? []
    );

  const hasSingleApprovalJob = openJobs && openJobs.length === 1;

  // YES clears opt-out only when it is not an approval reply.
  if (normalizedBody === "YES" && !hasSingleApprovalJob) {
    await admin
      .from("customer")
      .update({ sms_opted_out_at: null })
      .eq("customer_id", customer.customer_id);
    return null;
  }

  if (!hasSingleApprovalJob) return null;

  const job = openJobs[0];
  if (normalizedBody === "YES" || normalizedBody === "APPROVE") {
    const approvedAt = new Date().toISOString();
    await admin
      .from("job")
      .update({
        status: "approved",
        approval_method: "text",
        approved_by_customer_at: approvedAt,
        updated_at: approvedAt,
      })
      .eq("job_id", job.job_id);

    await addTimelineEvent(admin, {
      work_order_id: job.work_order_id,
      user_id: null,
      event_type: TimelineEventType.CUSTOMER_APPROVAL_RECORDED,
      entity_type: "job",
      entity_id: job.job_id,
      description: "Customer approved via SMS reply",
      new_value: { approval_method: "text" },
    });
  } else if (normalizedBody === "NO" || normalizedBody === "DECLINE") {
    const declinedAt = new Date().toISOString();
    await admin
      .from("job")
      .update({
        status: "declined",
        approval_method: "text",
        declined_at: declinedAt,
        decline_reason: "Declined via SMS",
        updated_at: declinedAt,
      })
      .eq("job_id", job.job_id);

    await addTimelineEvent(admin, {
      work_order_id: job.work_order_id,
      user_id: null,
      event_type: TimelineEventType.CUSTOMER_DECLINE_RECORDED,
      entity_type: "job",
      entity_id: job.job_id,
      description: "Customer declined via SMS reply",
      new_value: { approval_method: "text" },
    });
  }

  return null;
}
