import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { canViewBillingArea } from "@/lib/permissions";
import type { BillingStage } from "@/lib/billing/stages";
import { type BillingBucket, classifyBillingBucket } from "@/lib/billing/buckets";
import { estimateTotalsWithHst } from "@/lib/pricing/hst";

export type BillingBoardItem = {
  work_order_id: string;
  work_order_number: string;
  status: string;
  billing_stage: BillingStage;
  square_invoice_id: string | null;
  square_payment_status: string | null;
  square_invoice_public_url: string | null;
  billing_collected_cents: number;
  billing_amount_cents: number | null;
  estimate_cents: number;
  remaining_cents: number;
  bucket: BillingBucket;
  estimate_sent_at: string | null;
  invoice_published_at: string | null;
  customer_label: string;
  customer_phone: string | null;
  customer_email: string | null;
  sms_opted_out: boolean;
  motorcycle_label: string;
  href: string;
};

export type BillingDeskStats = {
  collected_today_cents: number;
  collected_week_cents: number;
  unpaid_total_cents: number;
  ready_to_invoice_count: number;
  unpaid_count: number;
  balance_due_count: number;
};

function unwrapOne<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export async function listBillingBoardForLocation(
  locationId: string
): Promise<BillingBoardItem[]> {
  const user = await requireUser();
  if (!canViewBillingArea(user.role)) throw new Error("FORBIDDEN");
  if (locationId !== user.active_location_id) throw new Error("FOREIGN_LOCATION");

  const supabase = await createClient();
  const { data: rows, error: listError } = await supabase
    .from("work_order")
    .select(
      `
      work_order_id,
      work_order_number,
      status,
      billing_stage,
      square_invoice_id,
      square_payment_status,
      square_invoice_public_url,
      billing_collected_cents,
      billing_amount_cents,
      estimate_sent_at,
      invoice_published_at,
      customer:customer_id ( first_name, last_name, phone, email, sms_opted_out_at ),
      motorcycle:motorcycle_id ( year, make, model ),
      job ( job_id, status, standard_price_snapshot )
    `
    )
    .eq("location_id", locationId)
    .not("status", "in", "(cancelled)")
    .order("updated_at", { ascending: false })
    .limit(200);

  if (listError) throw listError;

  const jobIds: string[] = [];
  const jobToWo = new Map<string, string>();
  for (const row of rows ?? []) {
    const jobs = (row.job as Array<{ job_id: string }> | null) ?? [];
    for (const job of jobs) {
      jobIds.push(job.job_id);
      jobToWo.set(job.job_id, row.work_order_id);
    }
  }

  const partTotals = new Map<string, number>();
  if (jobIds.length > 0) {
    const { data: parts, error: partsError } = await supabase
      .from("part")
      .select("job_id, quantity, unit_price, status")
      .in("job_id", jobIds);

    if (partsError) throw partsError;
    for (const part of parts ?? []) {
      if (part.status === "cancelled" || part.status === "not_required") continue;
      const woId = jobToWo.get(part.job_id);
      if (!woId) continue;
      const line = Number(part.unit_price ?? 0) * Number(part.quantity ?? 0);
      partTotals.set(woId, (partTotals.get(woId) ?? 0) + line);
    }
  }

  const items: BillingBoardItem[] = [];

  for (const row of rows ?? []) {
    const customer = unwrapOne(
      row.customer as
        | {
            first_name: string;
            last_name: string;
            phone: string | null;
            email: string | null;
            sms_opted_out_at: string | null;
          }
        | {
            first_name: string;
            last_name: string;
            phone: string | null;
            email: string | null;
            sms_opted_out_at: string | null;
          }[]
        | null
    );
    const motorcycle = unwrapOne(
      row.motorcycle as
        | { year: number; make: string; model: string }
        | { year: number; make: string; model: string }[]
        | null
    );
    const jobs =
      (row.job as Array<{
        status: string;
        standard_price_snapshot: number | null;
      }> | null) ?? [];

    const jobTotal = jobs
      .filter((j) => j.status !== "cancelled" && j.status !== "declined")
      .reduce((sum, j) => sum + Number(j.standard_price_snapshot ?? 0), 0);
    const merchandiseDollars = jobTotal + (partTotals.get(row.work_order_id) ?? 0);
    const { totalCents: estimate_cents } = estimateTotalsWithHst(merchandiseDollars);
    const collected = Number(row.billing_collected_cents ?? 0);
    const stage = (row.billing_stage ?? "none") as BillingStage;

    const bucket = classifyBillingBucket({
      billing_stage: stage,
      square_payment_status: row.square_payment_status,
      billing_collected_cents: collected,
      estimate_cents,
    });

    if (
      bucket === "other" &&
      stage === "none" &&
      !row.square_invoice_id &&
      collected === 0
    ) {
      continue;
    }

    items.push({
      work_order_id: row.work_order_id,
      work_order_number: row.work_order_number,
      status: row.status,
      billing_stage: stage,
      square_invoice_id: row.square_invoice_id,
      square_payment_status: row.square_payment_status,
      square_invoice_public_url: row.square_invoice_public_url,
      billing_collected_cents: collected,
      billing_amount_cents:
        row.billing_amount_cents == null ? null : Number(row.billing_amount_cents),
      estimate_cents,
      remaining_cents: Math.max(0, estimate_cents - collected),
      bucket,
      estimate_sent_at: row.estimate_sent_at,
      invoice_published_at: row.invoice_published_at,
      customer_label: customer
        ? `${customer.first_name} ${customer.last_name}`.trim()
        : "Customer",
      customer_phone: customer?.phone ?? null,
      customer_email: customer?.email ?? null,
      sms_opted_out: Boolean(customer?.sms_opted_out_at),
      motorcycle_label: motorcycle
        ? `${motorcycle.year} ${motorcycle.make} ${motorcycle.model}`
        : "Motorcycle",
      href: `/work_orders/${row.work_order_id}`,
    });
  }

  return items;
}

export function buildBillingDeskStats(
  items: BillingBoardItem[],
  now = new Date()
): BillingDeskStats {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(startOfDay);
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());

  let collected_today_cents = 0;
  let collected_week_cents = 0;
  let unpaid_total_cents = 0;
  let ready_to_invoice_count = 0;
  let unpaid_count = 0;
  let balance_due_count = 0;

  for (const item of items) {
    if (item.bucket === "ready_to_invoice") ready_to_invoice_count += 1;
    if (item.bucket === "unpaid") {
      unpaid_count += 1;
      unpaid_total_cents += item.remaining_cents;
    }
    if (item.bucket === "balance_due") {
      balance_due_count += 1;
      unpaid_total_cents += item.remaining_cents;
    }

    if (item.billing_collected_cents > 0 && item.invoice_published_at) {
      const when = new Date(item.invoice_published_at);
      if (!Number.isNaN(when.getTime())) {
        if (when >= startOfWeek) {
          collected_week_cents += item.billing_collected_cents;
        }
        if (when >= startOfDay) {
          collected_today_cents += item.billing_collected_cents;
        }
      }
    }
  }

  return {
    collected_today_cents,
    collected_week_cents,
    unpaid_total_cents,
    ready_to_invoice_count,
    unpaid_count,
    balance_due_count,
  };
}
