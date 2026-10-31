import { requireUser } from "@/lib/auth/session";
import {
  PICKUP_NOTICE_BLOCKER_COPY,
  pickupNoticeBlockers,
} from "@/lib/communications/pickupNotice";
import { createAdminClient } from "@/lib/database/supabase-admin";
import { createClient } from "@/lib/database/supabase-server";
import { canSendReadyForPickupNotice } from "@/lib/permissions";
import { normalizePhoneE164 } from "@/lib/phone/e164";
import { portalUrl } from "@/lib/portal/tokens";
import { sendEmail, isEmailConfigured } from "@/lib/email/send";
import { renderReadyForPickupMessage } from "@/lib/services/communications";
import { sendCustomerSms } from "@/lib/services/customerSms";
import { createPortalToken } from "@/lib/services/portal";
import { TORONTO_SHOP } from "@/lib/shop/toronto";
import { toFormErrorMessage } from "@/lib/services/errors";
import { logger } from "@/lib/security/logger";
import { addTimelineEvent } from "@/lib/timeline/addTimelineEvent";
import { TimelineEventType } from "@/lib/timeline/events";

export type PickupNoticeChannelResult = {
  status: "sent" | "failed" | "uncertain";
  detail: string | null;
};

export type PickupNoticeSendResult = {
  sms: PickupNoticeChannelResult;
  email: PickupNoticeChannelResult;
};

type CustomerRow = {
  customer_id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  sms_opted_out_at: string | null;
  wix_contact_id: string | null;
};

type WorkOrderNoticeRow = {
  work_order_id: string;
  work_order_number: string;
  location_id: string;
  status: string;
  ready_for_pickup_at: string | null;
  updated_at: string;
  customer: CustomerRow | CustomerRow[] | null;
  location: { code: string } | Array<{ code: string }> | null;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/**
 * Text and email the customer that the bike is ready. Both channels are
 * attempted together. A provider failure does not change the work order status.
 */
export async function sendReadyForPickupNotice(
  workOrderId: string
): Promise<PickupNoticeSendResult> {
  const user = await requireUser();
  if (!canSendReadyForPickupNotice(user.role)) throw new Error("FORBIDDEN");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("work_order")
    .select(
      `
      work_order_id,
      work_order_number,
      location_id,
      status,
      ready_for_pickup_at,
      updated_at,
      customer:customer_id (
        customer_id,
        first_name,
        last_name,
        phone,
        email,
        sms_opted_out_at,
        wix_contact_id
      ),
      location:location_id ( code )
    `
    )
    .eq("work_order_id", workOrderId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("WORK_ORDER_NOT_FOUND");

  const workOrder = data as unknown as WorkOrderNoticeRow;
  if (workOrder.location_id !== user.active_location_id) {
    throw new Error("FOREIGN_LOCATION");
  }
  if (workOrder.status !== "ready_for_pickup") {
    throw new Error("PICKUP_NOTICE_NOT_READY");
  }

  const customer = one(workOrder.customer);
  if (!customer) throw new Error("WORK_ORDER_NOT_FOUND");
  const locationCode = one(workOrder.location)?.code ?? "";
  const blockers = pickupNoticeBlockers({
    phone: customer.phone,
    email: customer.email,
    smsOptedOut: Boolean(customer.sms_opted_out_at),
    locationCode,
  });
  if (blockers.length > 0) {
    throw new Error(
      blockers.map((blocker) => PICKUP_NOTICE_BLOCKER_COPY[blocker]).join(" ")
    );
  }

  const phone = normalizePhoneE164(customer.phone);
  const email = customer.email?.trim() ?? "";
  if (!phone) throw new Error(PICKUP_NOTICE_BLOCKER_COPY.phone);
  if (!email) throw new Error(PICKUP_NOTICE_BLOCKER_COPY.email);

  let portalLink: string | undefined;
  try {
    const { token } = await createPortalToken({
      workOrderId,
      purpose: "full",
      expiresInDays: 14,
    });
    portalLink = portalUrl(token);
  } catch {
    portalLink = undefined;
  }

  const message = renderReadyForPickupMessage({
    customerName: customer.first_name,
    workOrderNumber: workOrder.work_order_number,
    portalLink,
    shopName: TORONTO_SHOP.tradeName,
  });
  const dedupeKey = workOrder.ready_for_pickup_at ?? workOrder.updated_at;
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    throw new Error("PICKUP_NOTICE_UNAVAILABLE");
  }

  const sms = await deliverChannel({
    admin,
    supabase,
    userId: user.user_id,
    workOrderId,
    customerId: customer.customer_id,
    channel: "sms",
    toAddress: phone,
    body: message.sms,
    dedupeKey,
    send: () =>
      sendCustomerSms({
        customerId: customer.customer_id,
        wixContactId: customer.wix_contact_id,
        to: phone,
        body: message.sms,
        localOptedOutAt: customer.sms_opted_out_at,
      }),
  });

  const emailResult = await deliverChannel({
    admin,
    supabase,
    userId: user.user_id,
    workOrderId,
    customerId: customer.customer_id,
    channel: "email",
    toAddress: email,
    body: message.emailHtml,
    dedupeKey,
    send: async () => {
      if (!(await isEmailConfigured(workOrder.location_id))) {
        throw new Error("EMAIL_NOT_CONFIGURED");
      }
      const result = await sendEmail({
        to: email,
        subject: message.emailSubject,
        html: message.emailHtml,
        text: message.emailText,
        locationId: workOrder.location_id,
      });
      return result.id;
    },
  });

  return { sms, email: emailResult };
}

async function deliverChannel(input: {
  admin: ReturnType<typeof createAdminClient>;
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  workOrderId: string;
  customerId: string;
  channel: "sms" | "email";
  toAddress: string;
  body: string;
  dedupeKey: string;
  send: () => Promise<string>;
}): Promise<PickupNoticeChannelResult> {
  const inserted = await input.admin
    .from("communication_log")
    .insert({
      work_order_id: input.workOrderId,
      customer_id: input.customerId,
      channel: input.channel,
      direction: "outbound",
      template_key: "ready_for_pickup",
      to_address: input.toAddress,
      from_address: input.channel === "sms" ? TORONTO_SHOP.phoneE164 : null,
      body: input.body,
      status: "queued",
      dedupe_key: input.dedupeKey,
      sent_by_user_id: input.userId,
    })
    .select("log_id")
    .single();

  if (inserted.error) {
    if (inserted.error.code === "23505") {
      const existing = await input.admin
        .from("communication_log")
        .select("status, error_message")
        .eq("work_order_id", input.workOrderId)
        .eq("channel", input.channel)
        .eq("template_key", "ready_for_pickup")
        .eq("dedupe_key", input.dedupeKey)
        .maybeSingle();
      const existingStatus = existing.data?.status;
      const status: PickupNoticeChannelResult["status"] =
        !existing.error && (existingStatus === "sent" || existingStatus === "delivered")
          ? "sent"
          : !existing.error && existingStatus === "failed"
            ? "failed"
            : "uncertain";
      return {
        status,
        detail:
          status === "sent"
            ? "Already sent for this pickup."
            : status === "uncertain"
              ? toFormErrorMessage(new Error("WIX_INBOX_SEND_UNCERTAIN"))
              : toFormErrorMessage(
                  new Error(existing.data?.error_message ?? "SEND_FAILED")
                ),
      };
    }
    return { status: "failed", detail: inserted.error.message };
  }

  const logId = inserted.data?.log_id as string | undefined;
  let externalId: string;
  try {
    externalId = await input.send();
  } catch (error) {
    const errorCode = error instanceof Error ? error.message : "SEND_FAILED";
    const uncertain = input.channel === "sms" && errorCode === "WIX_INBOX_SEND_UNCERTAIN";
    const detail = toFormErrorMessage(error);
    if (logId) {
      try {
        const updated = await input.admin
          .from("communication_log")
          .update({
            status: uncertain ? "queued" : "failed",
            error_message: uncertain ? errorCode : detail,
            ...(uncertain ? {} : { dedupe_key: null }),
          })
          .eq("log_id", logId);
        if (updated.error) {
          logger.warn("Pickup notice communication log reconciliation failed", {
            logId,
            channel: input.channel,
            phase: "failed",
            error: updated.error.message,
          });
        }
      } catch (updateError) {
        logger.warn("Pickup notice communication log reconciliation failed", {
          logId,
          channel: input.channel,
          phase: "failed",
          error: updateError instanceof Error ? updateError.message : "LOG_UPDATE_FAILED",
        });
      }
    }
    return { status: uncertain ? "uncertain" : "failed", detail };
  }

  let reconciliationDetail: string | null = null;
  if (logId) {
    try {
      const updated = await input.admin
        .from("communication_log")
        .update({
          status: "sent",
          external_id: externalId,
          error_message: null,
        })
        .eq("log_id", logId);
      if (updated.error) {
        reconciliationDetail =
          "Message sent, but its delivery record needs reconciliation.";
        logger.warn("Pickup notice communication log reconciliation failed", {
          logId,
          channel: input.channel,
          phase: "sent",
          error: updated.error.message,
        });
      }
    } catch (updateError) {
      reconciliationDetail =
        "Message sent, but its delivery record needs reconciliation.";
      logger.warn("Pickup notice communication log reconciliation failed", {
        logId,
        channel: input.channel,
        phase: "sent",
        error: updateError instanceof Error ? updateError.message : "LOG_UPDATE_FAILED",
      });
    }
  }
  try {
    await addTimelineEvent(input.supabase, {
      work_order_id: input.workOrderId,
      user_id: input.userId,
      event_type: TimelineEventType.MESSAGE_SENT,
      entity_type: "communication_log",
      entity_id: logId ?? null,
      description: `${input.channel.toUpperCase()} sent (ready_for_pickup)`,
      new_value: { channel: input.channel, template_key: "ready_for_pickup" },
    });
  } catch {
    // The customer message already left. A timeline write must not hide that.
  }
  return { status: "sent", detail: reconciliationDetail };
}
