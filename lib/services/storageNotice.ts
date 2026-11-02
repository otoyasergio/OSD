import "server-only";

import { createAdminClient } from "@/lib/database/supabase-admin";
import { shopDateKey } from "@/lib/datetime/format";
import { isEmailConfigured, sendEmail } from "@/lib/email/send";
import { getShopMailbox } from "@/lib/email/mailbox";
import { normalizePhoneE164 } from "@/lib/phone/e164";
import { sendCustomerSms } from "@/lib/services/customerSms";
import { toFormErrorMessage } from "@/lib/services/errors";
import { TORONTO_SHOP } from "@/lib/shop/toronto";
import {
  planStorageMonthNotice,
  renderStorageMonthNotice,
  STORAGE_NOTICE_TEMPLATE,
  storageNoticeDedupeKey,
} from "@/lib/storage/notice";

type NoticeRow = {
  work_order_id: string;
  location_id: string;
  stored_at: string | null;
  storage_pickup_by: string;
  storage_monthly_cents: number;
  customer:
    | {
        customer_id: string;
        first_name: string | null;
        phone: string | null;
        email: string | null;
        sms_opted_out_at: string | null;
        wix_contact_id: string | null;
      }
    | Array<{
        customer_id: string;
        first_name: string | null;
        phone: string | null;
        email: string | null;
        sms_opted_out_at: string | null;
        wix_contact_id: string | null;
      }>
    | null;
  motorcycle:
    | { year: number | null; make: string | null; model: string | null }
    | Array<{ year: number | null; make: string | null; model: string | null }>
    | null;
};

export async function sendStorageMonthNotices(now = new Date()): Promise<{
  ok: true;
  skipped?: "shop_closed";
  considered: number;
  sms: number;
  email: number;
}> {
  const admin = createAdminClient();
  const today = shopDateKey(now);
  const { data: location, error: locationError } = await admin
    .from("location")
    .select("location_id")
    .eq("code", TORONTO_SHOP.locationCode)
    .maybeSingle();
  if (locationError) throw locationError;
  if (!location?.location_id) return { ok: true, considered: 0, sms: 0, email: 0 };

  const { data: closure, error: closureError } = await admin
    .from("shop_closure")
    .select("closure_date")
    .eq("location_id", location.location_id)
    .eq("closure_date", today)
    .maybeSingle();
  if (closureError) throw closureError;
  if (closure) return { ok: true, skipped: "shop_closed", considered: 0, sms: 0, email: 0 };

  const { data, error } = await admin
    .from("work_order")
    .select(
      `
      work_order_id,
      location_id,
      stored_at,
      storage_pickup_by,
      storage_monthly_cents,
      customer:customer_id (
        customer_id,
        first_name,
        phone,
        email,
        sms_opted_out_at,
        wix_contact_id
      ),
      motorcycle:motorcycle_id ( year, make, model )
    `
    )
    .eq("location_id", location.location_id)
    .eq("status", "in_storage")
    .not("storage_pickup_by", "is", null)
    .not("storage_monthly_cents", "is", null);
  if (error) throw error;

  const rows = (data ?? []) as unknown as NoticeRow[];
  let sms = 0;
  let email = 0;
  for (const row of rows) {
    const result = await sendOneStorageNotice(admin, row, today);
    sms += result.sms;
    email += result.email;
  }
  return { ok: true, considered: rows.length, sms, email };
}

async function sendOneStorageNotice(
  admin: ReturnType<typeof createAdminClient>,
  row: NoticeRow,
  today: string
): Promise<{ sms: number; email: number }> {
  const customer = one(row.customer);
  const motorcycle = one(row.motorcycle);
  if (!customer || row.storage_monthly_cents == null || !row.storage_pickup_by) {
    return { sms: 0, email: 0 };
  }
  const storedAt = row.stored_at ?? row.work_order_id;
  const dedupeKey = storageNoticeDedupeKey(storedAt);
  const sent = await sentChannels(admin, row.work_order_id, dedupeKey);
  const plan = planStorageMonthNotice({
    today,
    pickupBy: row.storage_pickup_by,
    phone: customer.phone,
    email: customer.email,
    smsOptedOut: Boolean(customer.sms_opted_out_at),
    smsSent: sent.sms,
    emailSent: sent.email,
  });
  if (!plan) return { sms: 0, email: 0 };

  const message = renderStorageMonthNotice({
    customerName: customer.first_name ?? "",
    year: motorcycle?.year ?? null,
    make: motorcycle?.make ?? null,
    model: motorcycle?.model ?? null,
    pickupBy: row.storage_pickup_by,
    monthlyCents: row.storage_monthly_cents,
  });
  let smsCount = 0;
  let emailCount = 0;
  if (plan.sms === "send") {
    const phone = normalizePhoneE164(customer.phone);
    if (phone) {
      const delivered = await deliverChannel({
        admin,
        workOrderId: row.work_order_id,
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
      if (delivered) smsCount = 1;
    }
  }
  if (plan.email === "send" && customer.email?.trim()) {
    const email = customer.email.trim();
    const delivered = await deliverChannel({
      admin,
      workOrderId: row.work_order_id,
      customerId: customer.customer_id,
      channel: "email",
      toAddress: email,
      body: message.emailHtml,
      dedupeKey,
      send: async () => {
        if (!(await isEmailConfigured(row.location_id))) {
          throw new Error("EMAIL_NOT_CONFIGURED");
        }
        const mailbox = await getShopMailbox(row.location_id);
        if (!mailbox) throw new Error("EMAIL_NOT_CONFIGURED");
        const result = await sendEmail({
          to: email,
          subject: message.emailSubject,
          html: message.emailHtml,
          text: message.emailText,
          locationId: row.location_id,
        });
        return result.id;
      },
    });
    if (delivered) emailCount = 1;
  }
  return { sms: smsCount, email: emailCount };
}

async function sentChannels(
  admin: ReturnType<typeof createAdminClient>,
  workOrderId: string,
  dedupeKey: string
): Promise<{ sms: boolean; email: boolean }> {
  const { data, error } = await admin
    .from("communication_log")
    .select("channel, status")
    .eq("work_order_id", workOrderId)
    .eq("template_key", STORAGE_NOTICE_TEMPLATE)
    .eq("dedupe_key", dedupeKey);
  if (error) throw error;
  const rows = (data ?? []) as Array<{ channel: string; status: string }>;
  const claimed = (channel: string) =>
    rows.some(
      (row) =>
        row.channel === channel &&
        (row.status === "sent" || row.status === "delivered" || row.status === "queued")
    );
  return { sms: claimed("sms"), email: claimed("email") };
}

async function deliverChannel(input: {
  admin: ReturnType<typeof createAdminClient>;
  workOrderId: string;
  customerId: string;
  channel: "sms" | "email";
  toAddress: string;
  body: string;
  dedupeKey: string;
  send: () => Promise<string>;
}): Promise<boolean> {
  const inserted = await input.admin
    .from("communication_log")
    .insert({
      work_order_id: input.workOrderId,
      customer_id: input.customerId,
      channel: input.channel,
      direction: "outbound",
      template_key: STORAGE_NOTICE_TEMPLATE,
      to_address: input.toAddress,
      from_address: input.channel === "sms" ? TORONTO_SHOP.phoneE164 : null,
      body: input.body,
      status: "queued",
      dedupe_key: input.dedupeKey,
      sent_by_user_id: null,
    })
    .select("log_id")
    .single();
  if (inserted.error) {
    if (inserted.error.code === "23505") return false;
    throw inserted.error;
  }
  const logId = inserted.data?.log_id as string | undefined;
  try {
    const externalId = await input.send();
    if (logId) {
      await input.admin
        .from("communication_log")
        .update({ status: "sent", external_id: externalId, error_message: null })
        .eq("log_id", logId);
    }
    return true;
  } catch (error) {
    const code = error instanceof Error ? error.message : "SEND_FAILED";
    const uncertain = input.channel === "sms" && code === "WIX_INBOX_SEND_UNCERTAIN";
    if (logId) {
      await input.admin
        .from("communication_log")
        .update({
          status: uncertain ? "queued" : "failed",
          error_message: uncertain ? code : toFormErrorMessage(error),
          ...(uncertain ? {} : { dedupe_key: null }),
        })
        .eq("log_id", logId);
    }
    return false;
  }
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}
