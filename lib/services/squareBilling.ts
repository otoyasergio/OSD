import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { createAdminClient } from "@/lib/database/supabase-admin";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import { addTimelineEvent } from "@/lib/timeline/addTimelineEvent";
import { TimelineEventType } from "@/lib/timeline/events";
import { canMarkReadyForPickup, canRecordCustomerApproval } from "@/lib/permissions";
import {
  createSquareInvoice,
  getSquareInvoice,
  isSquareConfigured,
  upsertSquareCustomer,
} from "@/lib/square/client";

export type CustomerCredit = {
  credit_id: string;
  customer_id: string;
  amount: number;
  remaining_amount: number;
  reason: string;
  created_at: string;
};

export type SquareInvoiceSummary = {
  square_invoice_id: string;
  square_payment_status: string | null;
  public_url: string | null;
  total_cents: number;
  credit_applied: number;
};

function dollarsToCents(amount: number): bigint {
  return BigInt(Math.round(amount * 100));
}

export async function listCustomerCredits(
  customerId: string
): Promise<CustomerCredit[]> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customer_credit")
    .select("credit_id, customer_id, amount, remaining_amount, reason, created_at")
    .eq("customer_id", customerId)
    .gt("remaining_amount", 0)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data ?? []) as CustomerCredit[];
}

export async function addCustomerCredit(input: {
  customer_id: string;
  amount: number;
  reason: string;
  source_work_order_id?: string | null;
}): Promise<CustomerCredit> {
  const user = await requireUser();
  if (!canRecordCustomerApproval(user.role)) throw new Error("FORBIDDEN");
  if (input.amount <= 0) throw new Error("CREDIT_AMOUNT_INVALID");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customer_credit")
    .insert({
      customer_id: input.customer_id,
      amount: input.amount,
      remaining_amount: input.amount,
      reason: input.reason,
      source_work_order_id: input.source_work_order_id ?? null,
      created_by_user_id: user.user_id,
    })
    .select("credit_id, customer_id, amount, remaining_amount, reason, created_at")
    .single();

  if (error) throw error;

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: user.active_location_id,
    action: "customer_credit_added",
    entity_type: "customer_credit",
    entity_id: data.credit_id,
    description: `Customer credit $${input.amount.toFixed(2)} — ${input.reason}`,
    new_value: { amount: input.amount },
  });

  return data as CustomerCredit;
}

async function buildBillableLines(workOrderId: string) {
  const supabase = await createClient();
  const { data: jobs, error: jobsError } = await supabase
    .from("job")
    .select("job_id, name_snapshot, standard_price_snapshot, status")
    .eq("work_order_id", workOrderId)
    .in("status", ["approved", "waiting_for_parts", "ready_to_start", "in_progress", "completed"]);

  if (jobsError) throw jobsError;

  const jobIds = (jobs ?? []).map((j) => j.job_id);
  let parts: { part_name: string; quantity: number; unit_price: number | null }[] = [];

  if (jobIds.length > 0) {
    const { data: partRows, error: partsError } = await supabase
      .from("part")
      .select("part_name, quantity, unit_price, status")
      .in("job_id", jobIds)
      .not("status", "in", "(cancelled,not_required)");

    if (partsError) throw partsError;
    parts = (partRows ?? []).map((p) => ({
      part_name: p.part_name,
      quantity: p.quantity,
      unit_price: p.unit_price,
    }));
  }

  const lines: { name: string; amount: number }[] = [];

  for (const job of jobs ?? []) {
    const price = Number(job.standard_price_snapshot ?? 0);
    if (price > 0) {
      lines.push({ name: job.name_snapshot, amount: price });
    }
  }

  for (const part of parts) {
    const unit = Number(part.unit_price ?? 0);
    if (unit > 0) {
      lines.push({
        name: `${part.part_name} × ${part.quantity}`,
        amount: unit * part.quantity,
      });
    }
  }

  return lines;
}

export async function createWorkOrderSquareInvoice(
  workOrderId: string
): Promise<SquareInvoiceSummary> {
  const user = await requireUser();
  if (!canMarkReadyForPickup(user.role)) throw new Error("FORBIDDEN");
  if (!isSquareConfigured()) throw new Error("SQUARE_NOT_CONFIGURED");

  const supabase = await createClient();
  const { data: detail, error } = await supabase
    .from("work_order")
    .select(
      `
      work_order_id,
      work_order_number,
      location_id,
      status,
      square_invoice_id,
      square_payment_status,
      customer:customer_id (
        customer_id,
        first_name,
        last_name,
        email,
        phone,
        square_customer_id
      )
    `
    )
    .eq("work_order_id", workOrderId)
    .maybeSingle();

  if (error) throw error;
  if (!detail) throw new Error("WORK_ORDER_NOT_FOUND");
  if (detail.location_id !== user.active_location_id) {
    throw new Error("FOREIGN_LOCATION");
  }

  if (
    detail.status !== "ready_for_pickup" &&
    detail.status !== "completed"
  ) {
    throw new Error("SQUARE_INVOICE_NOT_READY");
  }

  if (detail.square_invoice_id) {
    const existing = await getSquareInvoice(detail.square_invoice_id);
    return {
      square_invoice_id: detail.square_invoice_id,
      square_payment_status: detail.square_payment_status,
      public_url: existing.public_url ?? null,
      total_cents: 0,
      credit_applied: 0,
    };
  }

  const customer = detail.customer as unknown as {
    customer_id: string;
    first_name: string;
    last_name: string;
    email: string | null;
    phone: string | null;
    square_customer_id: string | null;
  };

  const squareCustomer = await upsertSquareCustomer({
    givenName: customer.first_name,
    familyName: customer.last_name,
    email: customer.email,
    phone: customer.phone,
    referenceId: customer.customer_id,
    existingId: customer.square_customer_id,
  });

  if (squareCustomer.id !== customer.square_customer_id) {
    await supabase
      .from("customer")
      .update({ square_customer_id: squareCustomer.id })
      .eq("customer_id", customer.customer_id);
  }

  const billableLines = await buildBillableLines(workOrderId);
  if (billableLines.length === 0) throw new Error("SQUARE_NO_BILLABLE_LINES");

  const credits = await listCustomerCredits(customer.customer_id);
  let creditApplied = 0;
  for (const credit of credits) {
    creditApplied += Number(credit.remaining_amount);
  }

  let runningTotal = billableLines.reduce((sum, l) => sum + l.amount, 0);
  runningTotal = Math.max(0, runningTotal - creditApplied);

  const squareLines = billableLines.map((line) => ({
    name: line.name,
    quantity: "1",
    basePriceMoney: {
      amount: dollarsToCents(line.amount),
      currency: "CAD",
    },
  }));

  if (creditApplied > 0) {
    squareLines.push({
      name: "Customer credit applied",
      quantity: "1",
      basePriceMoney: {
        amount: dollarsToCents(-creditApplied),
        currency: "CAD",
      },
    });
  }

  const invoice = await createSquareInvoice({
    customerId: squareCustomer.id,
    title: `Work order ${detail.work_order_number}`,
    description: `Service invoice for ${detail.work_order_number}`,
    lineItems: squareLines,
  });

  await supabase
    .from("work_order")
    .update({
      square_invoice_id: invoice.id,
      square_payment_status: "unpaid",
    })
    .eq("work_order_id", workOrderId);

  await addTimelineEvent(supabase, {
    work_order_id: workOrderId,
    user_id: user.user_id,
    event_type: TimelineEventType.SQUARE_INVOICE_CREATED,
    entity_type: "work_order",
    entity_id: workOrderId,
    description: `Square invoice created for ${detail.work_order_number}`,
    new_value: { square_invoice_id: invoice.id, credit_applied: creditApplied },
  });

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: detail.location_id,
    action: "square_invoice_created",
    entity_type: "work_order",
    entity_id: workOrderId,
    description: `Square invoice on ${detail.work_order_number}`,
    new_value: { square_invoice_id: invoice.id },
  });

  return {
    square_invoice_id: invoice.id!,
    square_payment_status: "unpaid",
    public_url: invoice.public_url ?? null,
    total_cents: Math.round(runningTotal * 100),
    credit_applied: creditApplied,
  };
}

export async function processSquareWebhookEvent(payload: {
  type: string;
  event_id: string;
  data: { object?: { invoice?: { id?: string; status?: string } } };
}): Promise<void> {
  const admin = createAdminClient();

  const { error: dedupeError } = await admin.from("square_webhook_event").insert({
    square_event_id: payload.event_id,
    event_type: payload.type,
    payload,
  });

  if (dedupeError) {
    if (dedupeError.code === "23505") return;
    throw dedupeError;
  }

  const invoiceId = payload.data?.object?.invoice?.id;
  const invoiceStatus = payload.data?.object?.invoice?.status;
  if (!invoiceId) return;

  const statusMap: Record<string, string> = {
    PAID: "paid",
    PARTIALLY_PAID: "partially_paid",
    UNPAID: "unpaid",
    CANCELED: "cancelled",
    REFUNDED: "refunded",
  };

  const mapped = invoiceStatus ? statusMap[invoiceStatus] : null;
  if (!mapped) return;

  const { data: workOrders, error } = await admin
    .from("work_order")
    .select("work_order_id, work_order_number, location_id, customer_id")
    .eq("square_invoice_id", invoiceId);

  if (error) throw error;

  for (const wo of workOrders ?? []) {
    await admin
      .from("work_order")
      .update({ square_payment_status: mapped })
      .eq("work_order_id", wo.work_order_id);

    if (mapped === "paid") {
      const credits = await admin
        .from("customer_credit")
        .select("credit_id, remaining_amount")
        .eq("customer_id", wo.customer_id)
        .gt("remaining_amount", 0);

      for (const credit of credits.data ?? []) {
        await admin
          .from("customer_credit")
          .update({ remaining_amount: 0 })
          .eq("credit_id", credit.credit_id);
      }
    }

    await addTimelineEvent(admin, {
      work_order_id: wo.work_order_id,
      user_id: null,
      event_type: TimelineEventType.SQUARE_PAYMENT_UPDATED,
      entity_type: "work_order",
      entity_id: wo.work_order_id,
      description: `Square payment status: ${mapped}`,
      new_value: { square_payment_status: mapped },
    });
  }
}
