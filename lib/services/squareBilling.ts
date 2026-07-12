import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { createAdminClient } from "@/lib/database/supabase-admin";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import { addTimelineEvent } from "@/lib/timeline/addTimelineEvent";
import { TimelineEventType } from "@/lib/timeline/events";
import { canRecordCustomerApproval } from "@/lib/permissions";
import {
  type BillingAmountMode,
  type BillingStage,
  type BillableLine,
  DRAFT_JOB_STATUSES,
  PUBLISHABLE_JOB_STATUSES,
  computePublishAmountCents,
  dollarsToCents,
  stageAfterJobApprovals,
  sumLines,
} from "@/lib/billing/stages";
import {
  cancelSquareInvoice,
  createSquareInvoiceDraft,
  getSquareInvoice,
  isSquareConfigured,
  publishSquareInvoice,
  squareInvoiceDisplayNumber,
  upsertSquareCustomer,
} from "@/lib/square/client";
import { createPortalToken } from "@/lib/services/portal";
import { sendWorkOrderMessage } from "@/lib/services/communications";

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
  billing_stage: BillingStage;
};

type WorkOrderBillingRow = {
  work_order_id: string;
  work_order_number: string;
  location_id: string;
  status: string;
  customer_id: string;
  square_invoice_id: string | null;
  square_payment_status: string | null;
  square_invoice_public_url: string | null;
  billing_stage: BillingStage;
  billing_collected_cents: number;
  estimate_sent_at: string | null;
  customer: {
    customer_id: string;
    first_name: string;
    last_name: string;
    email: string | null;
    phone: string | null;
    square_customer_id: string | null;
  };
};

function toSquareMoney(amountDollars: number) {
  return {
    amount: BigInt(dollarsToCents(amountDollars)),
    currency: "CAD",
  };
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

async function buildLines(
  workOrderId: string,
  mode: "draft" | "publish"
): Promise<BillableLine[]> {
  const supabase = await createClient();
  const statuses =
    mode === "draft"
      ? [...DRAFT_JOB_STATUSES]
      : [...PUBLISHABLE_JOB_STATUSES];

  const { data: jobs, error: jobsError } = await supabase
    .from("job")
    .select("job_id, service_name_snapshot, standard_price_snapshot, status")
    .eq("work_order_id", workOrderId)
    .in("status", statuses);

  if (jobsError) throw jobsError;

  const jobIds = (jobs ?? []).map((j) => j.job_id);
  let parts: { part_name: string; quantity: number; unit_price: number | null }[] =
    [];

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

  const lines: BillableLine[] = [];

  for (const job of jobs ?? []) {
    const price = Number(job.standard_price_snapshot ?? 0);
    if (price > 0) {
      lines.push({ name: job.service_name_snapshot, amount: price });
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

async function loadBillingWorkOrder(
  workOrderId: string
): Promise<WorkOrderBillingRow> {
  const user = await requireUser();
  if (!canRecordCustomerApproval(user.role)) throw new Error("FORBIDDEN");

  const supabase = await createClient();
  const { data: detail, error } = await supabase
    .from("work_order")
    .select(
      `
      work_order_id,
      work_order_number,
      location_id,
      status,
      customer_id,
      square_invoice_id,
      square_payment_status,
      square_invoice_public_url,
      billing_stage,
      billing_collected_cents,
      estimate_sent_at,
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

  return {
    ...(detail as Omit<WorkOrderBillingRow, "customer" | "billing_stage">),
    billing_stage: (detail.billing_stage ?? "none") as BillingStage,
    billing_collected_cents: Number(detail.billing_collected_cents ?? 0),
    customer: detail.customer as unknown as WorkOrderBillingRow["customer"],
  };
}

async function ensureSquareCustomer(customer: WorkOrderBillingRow["customer"]) {
  const squareCustomer = await upsertSquareCustomer({
    givenName: customer.first_name,
    familyName: customer.last_name,
    email: customer.email,
    phone: customer.phone,
    referenceId: customer.customer_id,
    existingId: customer.square_customer_id,
  });

  if (squareCustomer.id !== customer.square_customer_id) {
    const supabase = await createClient();
    await supabase
      .from("customer")
      .update({ square_customer_id: squareCustomer.id })
      .eq("customer_id", customer.customer_id);
  }

  return squareCustomer;
}

function linesToSquareItems(lines: BillableLine[], creditApplied: number) {
  const squareLines = lines.map((line) => ({
    name: line.name,
    quantity: "1",
    basePriceMoney: toSquareMoney(line.amount),
  }));

  if (creditApplied > 0) {
    squareLines.push({
      name: "Customer credit applied",
      quantity: "1",
      basePriceMoney: toSquareMoney(-creditApplied),
    });
  }

  return squareLines;
}

export async function syncWorkOrderSquareDraft(
  workOrderId: string
): Promise<SquareInvoiceSummary> {
  const user = await requireUser();
  if (!isSquareConfigured()) throw new Error("SQUARE_NOT_CONFIGURED");

  const detail = await loadBillingWorkOrder(workOrderId);
  if (detail.billing_stage === "invoiced" || detail.billing_stage === "paid") {
    throw new Error("SQUARE_INVOICE_ALREADY_PUBLISHED");
  }

  const supabase = await createClient();

  if (detail.square_invoice_id && detail.square_payment_status === "draft") {
    try {
      const existing = await getSquareInvoice(detail.square_invoice_id);
      if (existing.status === "DRAFT" || existing.status === "UNPAID") {
        await cancelSquareInvoice(detail.square_invoice_id, existing.version ?? 0);
      }
    } catch {
      // Continue and create a fresh draft if cancel fails
    }
  } else if (
    detail.square_invoice_id &&
    detail.billing_stage !== "draft" &&
    detail.billing_stage !== "awaiting_approval" &&
    detail.billing_stage !== "ready_to_invoice" &&
    detail.billing_stage !== "none"
  ) {
    throw new Error("SQUARE_INVOICE_ALREADY_PUBLISHED");
  } else if (
    detail.square_invoice_id &&
    (detail.square_payment_status === "unpaid" ||
      detail.square_payment_status === "partially_paid" ||
      detail.square_payment_status === "paid")
  ) {
    throw new Error("SQUARE_INVOICE_ALREADY_PUBLISHED");
  }

  const squareCustomer = await ensureSquareCustomer(detail.customer);
  const billableLines = await buildLines(workOrderId, "draft");
  if (billableLines.length === 0) throw new Error("SQUARE_NO_BILLABLE_LINES");

  const invoice = await createSquareInvoiceDraft({
    customerId: squareCustomer.id,
    title: `Estimate ${detail.work_order_number}`,
    description: `Service estimate for ${detail.work_order_number}`,
    lineItems: linesToSquareItems(billableLines, 0),
  });

  const nextStage: BillingStage =
    detail.billing_stage === "awaiting_approval" ||
    detail.billing_stage === "ready_to_invoice"
      ? detail.billing_stage
      : "draft";

  const displayNumber = squareInvoiceDisplayNumber(invoice);

  await supabase
    .from("work_order")
    .update({
      square_invoice_id: invoice.id,
      square_payment_status: "draft",
      square_invoice_public_url: invoice.public_url ?? null,
      billing_stage: nextStage,
      ...(displayNumber
        ? { external_invoice_number: displayNumber }
        : {}),
    })
    .eq("work_order_id", workOrderId);

  await addTimelineEvent(supabase, {
    work_order_id: workOrderId,
    user_id: user.user_id,
    event_type: TimelineEventType.SQUARE_INVOICE_DRAFT_SYNCED,
    entity_type: "work_order",
    entity_id: workOrderId,
    description: `Square draft synced for ${detail.work_order_number}`,
    new_value: {
      square_invoice_id: invoice.id,
      external_invoice_number: displayNumber,
    },
  });

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: detail.location_id,
    action: "square_invoice_draft_synced",
    entity_type: "work_order",
    entity_id: workOrderId,
    description: `Square draft on ${detail.work_order_number}`,
    new_value: {
      square_invoice_id: invoice.id,
      external_invoice_number: displayNumber,
    },
  });

  return {
    square_invoice_id: invoice.id!,
    square_payment_status: "draft",
    public_url: invoice.public_url ?? null,
    total_cents: dollarsToCents(sumLines(billableLines)),
    credit_applied: 0,
    billing_stage: nextStage,
  };
}

export async function sendWorkOrderEstimateApproval(
  workOrderId: string,
  channel: "sms" | "email" = "email"
): Promise<{ sent: boolean }> {
  const user = await requireUser();
  const detail = await loadBillingWorkOrder(workOrderId);
  const supabase = await createClient();

  let sent = false;
  try {
    await sendWorkOrderMessage({
      work_order_id: workOrderId,
      channel,
      template_key: "approval_request",
    });
    sent = true;
  } catch {
    // Messaging may be unconfigured in alpha — still mark estimate sent for staff portal use
    await createPortalToken({
      workOrderId,
      purpose: "estimate",
      expiresInDays: 14,
    });
  }

  await supabase
    .from("work_order")
    .update({
      billing_stage: "awaiting_approval",
      estimate_sent_at: new Date().toISOString(),
    })
    .eq("work_order_id", workOrderId);

  await addTimelineEvent(supabase, {
    work_order_id: workOrderId,
    user_id: user.user_id,
    event_type: TimelineEventType.ESTIMATE_SENT,
    entity_type: "work_order",
    entity_id: workOrderId,
    description: `Estimate approval sent for ${detail.work_order_number}`,
    new_value: { channel, message_sent: sent },
  });

  return { sent };
}

export async function publishWorkOrderSquareInvoice(
  workOrderId: string,
  input: {
    mode: BillingAmountMode;
    depositPercent?: number;
    customCents?: number;
  }
): Promise<SquareInvoiceSummary> {
  const user = await requireUser();
  if (!isSquareConfigured()) throw new Error("SQUARE_NOT_CONFIGURED");

  const detail = await loadBillingWorkOrder(workOrderId);

  const publishingBalance = input.mode === "balance";
  if (detail.billing_stage === "paid" && !publishingBalance) {
    throw new Error("SQUARE_ALREADY_PAID");
  }
  if (
    detail.billing_stage === "invoiced" &&
    detail.square_payment_status !== "cancelled" &&
    detail.square_payment_status !== "paid" &&
    !publishingBalance
  ) {
    throw new Error("SQUARE_INVOICE_ALREADY_PUBLISHED");
  }
  // Balance after a paid deposit: prior invoice stays in timeline; new active invoice is created
  if (
    publishingBalance &&
    detail.square_payment_status !== "paid" &&
    detail.billing_collected_cents <= 0
  ) {
    throw new Error("SQUARE_BALANCE_NOT_READY");
  }

  const supabase = await createClient();
  const squareCustomer = await ensureSquareCustomer(detail.customer);
  const publishLines = await buildLines(workOrderId, "publish");
  if (publishLines.length === 0) throw new Error("SQUARE_NO_BILLABLE_LINES");

  const credits = await listCustomerCredits(detail.customer.customer_id);
  const creditApplied = credits.reduce(
    (sum, c) => sum + Number(c.remaining_amount),
    0
  );

  const billableTotalCents = Math.max(
    0,
    dollarsToCents(sumLines(publishLines)) - dollarsToCents(creditApplied)
  );
  const chargeCents = computePublishAmountCents({
    mode: input.mode,
    billableTotalCents,
    collectedCents: detail.billing_collected_cents,
    depositPercent: input.depositPercent,
    customCents: input.customCents,
  });

  if (chargeCents <= 0) throw new Error("SQUARE_NO_BILLABLE_LINES");

  // Cancel existing draft before publishing a new one
  if (detail.square_invoice_id) {
    try {
      const existing = await getSquareInvoice(detail.square_invoice_id);
      if (existing.status === "DRAFT") {
        await cancelSquareInvoice(detail.square_invoice_id, existing.version ?? 0);
      }
    } catch {
      // ignore
    }
  }

  const isDeposit =
    input.mode === "deposit_percent" || input.mode === "custom";
  const useSingleChargeLine =
    isDeposit || input.mode === "balance" || detail.billing_collected_cents > 0;

  const lineItems = useSingleChargeLine
    ? [
        {
          name: `${isDeposit ? "Deposit" : "Balance"} — ${detail.work_order_number}`,
          quantity: "1",
          basePriceMoney: {
            amount: BigInt(chargeCents),
            currency: "CAD",
          },
        },
      ]
    : linesToSquareItems(publishLines, creditApplied);

  const draft = await createSquareInvoiceDraft({
    customerId: squareCustomer.id,
    title: isDeposit
      ? `Deposit ${detail.work_order_number}`
      : `Invoice ${detail.work_order_number}`,
    description: `Service ${isDeposit ? "deposit" : "invoice"} for ${detail.work_order_number}`,
    lineItems,
  });

  const invoice = await publishSquareInvoice(draft.id, draft.version ?? 0);
  const displayNumber =
    squareInvoiceDisplayNumber(invoice) ??
    squareInvoiceDisplayNumber(draft);

  await supabase
    .from("work_order")
    .update({
      square_invoice_id: invoice.id,
      square_payment_status: "unpaid",
      square_invoice_public_url: invoice.public_url ?? null,
      billing_stage: "invoiced",
      billing_amount_mode: input.mode,
      billing_amount_cents: chargeCents,
      invoice_published_at: new Date().toISOString(),
      ...(displayNumber
        ? { external_invoice_number: displayNumber }
        : {}),
    })
    .eq("work_order_id", workOrderId);

  await addTimelineEvent(supabase, {
    work_order_id: workOrderId,
    user_id: user.user_id,
    event_type: TimelineEventType.SQUARE_INVOICE_PUBLISHED,
    entity_type: "work_order",
    entity_id: workOrderId,
    description: `Square invoice published for ${detail.work_order_number}`,
    new_value: {
      square_invoice_id: invoice.id,
      external_invoice_number: displayNumber,
      mode: input.mode,
      amount_cents: chargeCents,
      previous_invoice_id: detail.square_invoice_id,
    },
  });

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: detail.location_id,
    action: "square_invoice_published",
    entity_type: "work_order",
    entity_id: workOrderId,
    description: `Square invoice published on ${detail.work_order_number}`,
    new_value: {
      square_invoice_id: invoice.id,
      external_invoice_number: displayNumber,
      mode: input.mode,
    },
  });

  return {
    square_invoice_id: invoice.id!,
    square_payment_status: "unpaid",
    public_url: invoice.public_url ?? null,
    total_cents: chargeCents,
    credit_applied: isDeposit ? 0 : creditApplied,
    billing_stage: "invoiced",
  };
}

export async function publishWorkOrderSquareBalance(
  workOrderId: string
): Promise<SquareInvoiceSummary> {
  return publishWorkOrderSquareInvoice(workOrderId, { mode: "balance" });
}

export async function cancelAndRecreateSquareInvoice(
  workOrderId: string
): Promise<void> {
  const user = await requireUser();
  if (!isSquareConfigured()) throw new Error("SQUARE_NOT_CONFIGURED");

  const detail = await loadBillingWorkOrder(workOrderId);
  const status = detail.square_payment_status;
  if (status === "partially_paid" || status === "paid") {
    throw new Error("SQUARE_CANCEL_NOT_ALLOWED");
  }

  const supabase = await createClient();

  if (detail.square_invoice_id) {
    try {
      const existing = await getSquareInvoice(detail.square_invoice_id);
      if (existing.status !== "CANCELED" && existing.status !== "PAID") {
        await cancelSquareInvoice(detail.square_invoice_id, existing.version ?? 0);
      }
    } catch {
      // Clear local state even if Square cancel fails
    }
  }

  await supabase
    .from("work_order")
    .update({
      square_invoice_id: null,
      square_payment_status: null,
      square_invoice_public_url: null,
      external_invoice_number: null,
      billing_stage: "none",
      billing_amount_mode: null,
      billing_amount_cents: null,
      invoice_published_at: null,
    })
    .eq("work_order_id", workOrderId);

  await addTimelineEvent(supabase, {
    work_order_id: workOrderId,
    user_id: user.user_id,
    event_type: TimelineEventType.SQUARE_INVOICE_CANCELLED,
    entity_type: "work_order",
    entity_id: workOrderId,
    description: `Square invoice cancelled for ${detail.work_order_number}`,
    new_value: { previous_invoice_id: detail.square_invoice_id },
  });
}

/** @deprecated Use publishWorkOrderSquareInvoice — kept for older callers */
export async function createWorkOrderSquareInvoice(
  workOrderId: string
): Promise<SquareInvoiceSummary> {
  return publishWorkOrderSquareInvoice(workOrderId, { mode: "full" });
}

export async function recomputeWorkOrderBillingStage(
  workOrderId: string
): Promise<void> {
  const admin = createAdminClient();
  const { data: wo } = await admin
    .from("work_order")
    .select(
      "billing_stage, square_invoice_id, estimate_sent_at, square_payment_status"
    )
    .eq("work_order_id", workOrderId)
    .maybeSingle();

  if (!wo) return;
  const current = (wo.billing_stage ?? "none") as BillingStage;
  if (current === "invoiced" || current === "paid") return;

  const { data: jobs } = await admin
    .from("job")
    .select("job_id, status, standard_price_snapshot")
    .eq("work_order_id", workOrderId);

  const hasAwaitingApproval = (jobs ?? []).some(
    (j) => j.status === "waiting_for_approval"
  );
  const publishableJobs = (jobs ?? []).filter((j) =>
    (PUBLISHABLE_JOB_STATUSES as readonly string[]).includes(j.status)
  );
  const jobIds = publishableJobs.map((j) => j.job_id);

  let hasPublishableLines = publishableJobs.some(
    (j) => Number(j.standard_price_snapshot ?? 0) > 0
  );

  if (!hasPublishableLines && jobIds.length > 0) {
    const { data: parts } = await admin
      .from("part")
      .select("unit_price, quantity, status")
      .in("job_id", jobIds)
      .not("status", "in", "(cancelled,not_required)");
    hasPublishableLines = (parts ?? []).some(
      (p) => Number(p.unit_price ?? 0) * Number(p.quantity ?? 0) > 0
    );
  }

  const next = stageAfterJobApprovals({
    current,
    hasPublishableLines,
    hasAwaitingApproval,
    hasSquareDraft: Boolean(wo.square_invoice_id),
    estimateSent: Boolean(wo.estimate_sent_at),
  });

  if (next !== current) {
    await admin
      .from("work_order")
      .update({ billing_stage: next })
      .eq("work_order_id", workOrderId);
  }
}

export async function processSquareWebhookEvent(payload: {
  type: string;
  event_id: string;
  data: {
    object?: {
      invoice?: {
        id?: string;
        invoice_number?: string;
        status?: string;
        payment_requests?: Array<{
          computed_amount_money?: { amount?: number };
          total_completed_amount_money?: { amount?: number };
        }>;
      };
    };
  };
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

  const invoice = payload.data?.object?.invoice;
  const invoiceId = invoice?.id;
  const invoiceStatus = invoice?.status;
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

  const paidAmount =
    invoice?.payment_requests?.[0]?.total_completed_amount_money?.amount ?? null;

  const { data: workOrders, error } = await admin
    .from("work_order")
    .select(
      "work_order_id, work_order_number, location_id, customer_id, billing_collected_cents, billing_amount_cents, billing_amount_mode"
    )
    .eq("square_invoice_id", invoiceId);

  if (error) throw error;

  for (const wo of workOrders ?? []) {
    const displayNumber = squareInvoiceDisplayNumber({
      invoice_number: invoice?.invoice_number,
      id: invoiceId,
    });
    const updates: Record<string, unknown> = {
      square_payment_status: mapped,
      ...(displayNumber ? { external_invoice_number: displayNumber } : {}),
    };
    const mode = wo.billing_amount_mode as string | null;
    const isDeposit = mode === "deposit_percent" || mode === "custom";

    if (mapped === "paid") {
      const add =
        paidAmount ?? Number(wo.billing_amount_cents ?? 0);
      const collected =
        Number(wo.billing_collected_cents ?? 0) + (add > 0 ? add : 0);
      updates.billing_collected_cents = collected;
      // Deposit paid → ready for balance invoice; full/balance paid → paid
      updates.billing_stage = isDeposit ? "ready_to_invoice" : "paid";

      if (!isDeposit) {
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
    } else if (mapped === "partially_paid") {
      updates.billing_stage = "invoiced";
      if (paidAmount != null) {
        updates.billing_collected_cents = Math.max(
          Number(wo.billing_collected_cents ?? 0),
          paidAmount
        );
      }
    } else if (mapped === "cancelled") {
      updates.billing_stage = "none";
    }

    await admin
      .from("work_order")
      .update(updates)
      .eq("work_order_id", wo.work_order_id);

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
