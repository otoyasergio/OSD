import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { addTimelineEvent } from "@/lib/timeline/addTimelineEvent";
import { TimelineEventType } from "@/lib/timeline/events";
import { canRecordCustomerApproval } from "@/lib/permissions";
import { normalizePhoneE164 } from "@/lib/phone/e164";
import { sendEmail, isEmailConfigured } from "@/lib/email/send";
import { portalUrl } from "@/lib/portal/tokens";
import { sendCustomerSms } from "@/lib/services/customerSms";
import { createPortalToken } from "@/lib/services/portal";
import { TORONTO_SHOP } from "@/lib/shop/toronto";

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

/** CASL / A2P campaign alignment — Wix Inbox owns carrier opt-out replies. */
const SMS_OPT_OUT_FOOTER = "Reply STOP to opt out.";

function withSmsOptOut(body: string): string {
  return `${body.trim()} ${SMS_OPT_OUT_FOOTER}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export type ReadyForPickupMessage = {
  sms: string;
  emailSubject: string;
  emailHtml: string;
  emailText: string;
};

/** Shared Ready for pickup copy for the board prompt and the manual panel. */
export function renderReadyForPickupMessage(ctx: TemplateContext): ReadyForPickupMessage {
  const name = ctx.customerName.trim() || "there";
  const workOrderNumber = ctx.workOrderNumber.trim();
  const payLine = ctx.portalLink ? ` Pay online: ${ctx.portalLink}` : "";
  const sms = withSmsOptOut(
    `Hi ${name}, your motorcycle (${workOrderNumber}) is ready for pickup at ${TORONTO_SHOP.tradeName}, ${TORONTO_SHOP.streetAddress}. Hours: ${TORONTO_SHOP.hours}. ${TORONTO_SHOP.sunday}.${payLine}`
  );
  const safeName = escapeHtml(name);
  const safeWorkOrder = escapeHtml(workOrderNumber);
  const payHtml = ctx.portalLink
    ? `<p><a href="${escapeHtml(ctx.portalLink)}">Pay online</a></p>`
    : "";
  const emailHtml = `<p>Hi ${safeName},</p><p>Your motorcycle (${safeWorkOrder}) is ready for pickup at <strong>${escapeHtml(TORONTO_SHOP.fullAddress)}</strong>.</p><p>Hours: ${escapeHtml(TORONTO_SHOP.hours)}. ${escapeHtml(TORONTO_SHOP.sunday)}.</p><p>Phone: ${escapeHtml(TORONTO_SHOP.phoneDisplay)}</p>${payHtml}<p>— ${escapeHtml(TORONTO_SHOP.legalName)}</p>`;
  const emailText = [
    `Hi ${name},`,
    "",
    `Your motorcycle (${workOrderNumber}) is ready for pickup at ${TORONTO_SHOP.fullAddress}.`,
    `Hours: ${TORONTO_SHOP.hours}. ${TORONTO_SHOP.sunday}.`,
    `Phone: ${TORONTO_SHOP.phoneDisplay}`,
    ...(ctx.portalLink ? [`Pay online: ${ctx.portalLink}`] : []),
    "",
    TORONTO_SHOP.legalName,
  ].join("\n");

  return {
    sms,
    emailSubject: `Ready for pickup — ${workOrderNumber}`,
    emailHtml,
    emailText,
  };
}

const TEMPLATES: Record<
  string,
  {
    sms: (ctx: TemplateContext) => string;
    emailSubject: (ctx: TemplateContext) => string;
    emailHtml: (ctx: TemplateContext) => string;
    emailText?: (ctx: TemplateContext) => string;
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
    sms: (ctx) => renderReadyForPickupMessage(ctx).sms,
    emailSubject: (ctx) => renderReadyForPickupMessage(ctx).emailSubject,
    emailHtml: (ctx) => renderReadyForPickupMessage(ctx).emailHtml,
    emailText: (ctx) => renderReadyForPickupMessage(ctx).emailText,
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
      customer:customer_id ( customer_id, first_name, last_name, phone, email, sms_opted_out_at, wix_contact_id )
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
    wix_contact_id: string | null;
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

  if (input.channel === "sms") {
    if (!customer.phone?.trim()) throw new Error("CUSTOMER_PHONE_REQUIRED");
    const toAddress = normalizePhoneE164(customer.phone);
    if (!toAddress) throw new Error("INVALID_PHONE");
    const body = template.sms(ctx);

    const { data: queuedLog, error: queueError } = await supabase
      .from("communication_log")
      .insert({
        work_order_id: input.work_order_id,
        customer_id: customer.customer_id,
        channel: "sms",
        direction: "outbound",
        template_key: input.template_key,
        to_address: toAddress,
        body,
        status: "queued",
        external_id: null,
        from_address: TORONTO_SHOP.phoneE164,
        error_message: null,
        sent_by_user_id: user.user_id,
      })
      .select(
        "log_id, channel, direction, to_address, body, status, template_key, created_at"
      )
      .single();

    if (queueError) throw queueError;

    let externalId: string;
    try {
      externalId = await sendCustomerSms({
        customerId: customer.customer_id,
        wixContactId: customer.wix_contact_id,
        to: customer.phone,
        body,
        localOptedOutAt: customer.sms_opted_out_at,
      });
    } catch (error) {
      const errorCode = error instanceof Error ? error.message : "SEND_FAILED";
      const uncertain = errorCode === "WIX_INBOX_SEND_UNCERTAIN";
      try {
        await supabase
          .from("communication_log")
          .update({
            status: uncertain ? "queued" : "failed",
            external_id: null,
            error_message: errorCode,
          })
          .eq("log_id", queuedLog.log_id);
      } catch {
        // Preserve the provider outcome when log reconciliation itself fails.
      }
      throw error;
    }

    const { error: sentUpdateError } = await supabase
      .from("communication_log")
      .update({
        status: "sent",
        external_id: externalId,
        error_message: null,
      })
      .eq("log_id", queuedLog.log_id);
    if (sentUpdateError) throw sentUpdateError;

    await addTimelineEvent(supabase, {
      work_order_id: input.work_order_id,
      user_id: user.user_id,
      event_type: TimelineEventType.MESSAGE_SENT,
      entity_type: "communication_log",
      entity_id: queuedLog.log_id,
      description: `SMS sent (${input.template_key})`,
      new_value: { channel: "sms", template_key: input.template_key },
    });

    return {
      ...queuedLog,
      status: "sent",
    } as CommunicationLogEntry;
  }

  const toAddress = customer.email?.trim() ?? "";
  let externalId: string | null = null;
  let status: CommunicationLogEntry["status"] = "sent";
  const body = template.emailHtml(ctx);
  let errorMessage: string | null = null;

  try {
    if (!(await isEmailConfigured(wo.location_id)))
      throw new Error("EMAIL_NOT_CONFIGURED");
    if (!toAddress) throw new Error("CUSTOMER_EMAIL_REQUIRED");
    const result = await sendEmail({
      to: toAddress,
      subject: template.emailSubject(ctx),
      html: body,
      text: template.emailText?.(ctx) ?? template.sms(ctx),
      locationId: wo.location_id,
    });
    externalId = result.id;
  } catch (err) {
    status = "failed";
    errorMessage = err instanceof Error ? err.message : "SEND_FAILED";
  }

  const { data: log, error: logError } = await supabase
    .from("communication_log")
    .insert({
      work_order_id: input.work_order_id,
      customer_id: customer.customer_id,
      channel: "email",
      direction: "outbound",
      template_key: input.template_key,
      to_address: toAddress,
      body,
      status,
      external_id: externalId,
      from_address: null,
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
