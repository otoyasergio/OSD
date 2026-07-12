import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import { addTimelineEvent } from "@/lib/timeline/addTimelineEvent";
import { TimelineEventType } from "@/lib/timeline/events";
import { canCreateWixInvoice } from "@/lib/permissions";
import {
  getWixInvoiceBridgeConfig,
  isWixContactsConfigured,
  isWixInvoiceConfigured,
} from "@/lib/wix/config";
import { buildInvoiceLineItems, createWixInvoiceViaBridge } from "@/lib/wix/invoices";
import { syncCustomerToWix } from "@/lib/services/wixContacts";
import type { WorkOrderStatus } from "@/lib/database/types";

const INVOICE_ELIGIBLE: WorkOrderStatus[] = [
  "ready_for_pickup",
  "completed",
];

export type WixInvoiceResult = {
  wix_invoice_id: string;
  external_invoice_number: string | null;
};

export function isWixInvoiceAvailable(): boolean {
  return isWixInvoiceConfigured() && isWixContactsConfigured();
}

/**
 * Create a Wix invoice draft from a completed / ready work order.
 * Ensures the customer is linked in Wix first, then calls the site HTTP bridge.
 */
export async function createWixInvoiceForWorkOrder(
  workOrderId: string
): Promise<WixInvoiceResult> {
  const user = await requireUser();
  if (!canCreateWixInvoice(user.role)) throw new Error("FORBIDDEN");
  if (!isWixInvoiceConfigured()) throw new Error("WIX_INVOICE_NOT_CONFIGURED");
  if (!isWixContactsConfigured()) throw new Error("WIX_NOT_CONFIGURED");

  const supabase = await createClient();

  const { data: wo, error: woError } = await supabase
    .from("work_order")
    .select(
      `
      work_order_id,
      work_order_number,
      status,
      location_id,
      external_invoice_number,
      wix_invoice_id,
      customer:customer_id (
        customer_id,
        first_name,
        last_name,
        phone,
        email,
        wix_contact_id
      ),
      motorcycle:motorcycle_id (
        year,
        make,
        model
      ),
      job (
        service_name_snapshot,
        standard_price_snapshot,
        status
      )
    `
    )
    .eq("work_order_id", workOrderId)
    .maybeSingle();

  if (woError) throw woError;
  if (!wo) throw new Error("WORK_ORDER_NOT_FOUND");

  if (wo.location_id !== user.active_location_id) {
    throw new Error("FOREIGN_LOCATION");
  }

  if (!INVOICE_ELIGIBLE.includes(wo.status as WorkOrderStatus)) {
    throw new Error("WIX_INVOICE_STATUS");
  }

  if (wo.wix_invoice_id) {
    throw new Error("WIX_INVOICE_ALREADY_EXISTS");
  }

  const customerRel = wo.customer as
    | {
        customer_id: string;
        first_name: string;
        last_name: string;
        phone: string | null;
        email: string | null;
        wix_contact_id: string | null;
      }
    | Array<{
        customer_id: string;
        first_name: string;
        last_name: string;
        phone: string | null;
        email: string | null;
        wix_contact_id: string | null;
      }>
    | null;
  const customer = Array.isArray(customerRel) ? customerRel[0] ?? null : customerRel;

  if (!customer) throw new Error("CUSTOMER_NOT_FOUND");

  let wixContactId = customer.wix_contact_id;
  if (!wixContactId) {
    const synced = await syncCustomerToWix(customer.customer_id);
    wixContactId = synced.wix_contact_id;
  }
  if (!wixContactId) throw new Error("WIX_CONTACT_SYNC_FAILED");

  const { data: jobRows, error: jobIdsError } = await supabase
    .from("job")
    .select("job_id")
    .eq("work_order_id", workOrderId);

  if (jobIdsError) throw jobIdsError;
  const jobIds = (jobRows ?? []).map((row: { job_id: string }) => row.job_id);

  let parts: Array<{
    part_name: string;
    part_number: string | null;
    quantity: number;
    unit_price: number | null;
    status: string;
  }> = [];

  if (jobIds.length > 0) {
    const { data: partRows, error: partsError } = await supabase
      .from("part")
      .select("part_name, part_number, quantity, unit_price, status")
      .in("job_id", jobIds);
    if (partsError) throw partsError;
    parts = (partRows ?? []) as typeof parts;
  }

  const jobs =
    (wo.job as Array<{
      service_name_snapshot: string;
      standard_price_snapshot: number | null;
      status: string;
    }> | null) ?? [];

  const lineItems = buildInvoiceLineItems({
    workOrderNumber: wo.work_order_number as string,
    jobs,
    parts,
  });

  if (lineItems.length === 0) {
    throw new Error("WIX_INVOICE_NO_LINE_ITEMS");
  }

  const motorcycleRel = wo.motorcycle as
    | { year: number; make: string; model: string }
    | Array<{ year: number; make: string; model: string }>
    | null;
  const motorcycle = Array.isArray(motorcycleRel)
    ? motorcycleRel[0] ?? null
    : motorcycleRel;

  const { currency } = getWixInvoiceBridgeConfig();
  const title = motorcycle
    ? `${wo.work_order_number} · ${motorcycle.year} ${motorcycle.make} ${motorcycle.model}`
    : String(wo.work_order_number);

  const created = await createWixInvoiceViaBridge({
    workOrderNumber: String(wo.work_order_number),
    title,
    currency,
    contactId: wixContactId,
    email: customer.email,
    customer: {
      firstName: customer.first_name,
      lastName: customer.last_name,
      phone: customer.phone,
      email: customer.email,
    },
    lineItems,
    metadata: {
      work_order_id: workOrderId,
      work_order_number: String(wo.work_order_number),
    },
  });

  const invoiceNumber =
    created.invoiceNumber?.trim() ||
    (wo.external_invoice_number as string | null) ||
    created.invoiceId;

  const { error: updateError } = await supabase
    .from("work_order")
    .update({
      wix_invoice_id: created.invoiceId,
      external_invoice_number: invoiceNumber,
      updated_at: new Date().toISOString(),
    })
    .eq("work_order_id", workOrderId);

  if (updateError) throw updateError;

  await addTimelineEvent(supabase, {
    work_order_id: workOrderId,
    user_id: user.user_id,
    event_type: TimelineEventType.EXTERNAL_INVOICE_NUMBER_ADDED,
    entity_type: "work_order",
    entity_id: workOrderId,
    description: `Wix invoice created (${invoiceNumber})`,
    new_value: {
      wix_invoice_id: created.invoiceId,
      invoice_number: invoiceNumber,
    },
  });

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: user.active_location_id,
    action: "work_order_wix_invoice_created",
    entity_type: "work_order",
    entity_id: workOrderId,
    description: `Wix invoice ${invoiceNumber} created for ${wo.work_order_number}`,
    new_value: {
      wix_invoice_id: created.invoiceId,
      external_invoice_number: invoiceNumber,
    },
  });

  return {
    wix_invoice_id: created.invoiceId,
    external_invoice_number: invoiceNumber,
  };
}
