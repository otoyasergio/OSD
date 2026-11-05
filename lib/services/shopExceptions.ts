import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import type { BillingStage } from "@/lib/billing/stages";
import type { WorkOrderStatus } from "@/lib/database/types";
import { canViewReports } from "@/lib/permissions";
import { thinPartsMargin } from "@/lib/purchasing/controls";
import { classifyShopExceptions, type ShopExceptionKind } from "@/lib/reports/exceptions";
import {
  isUndefinedColumnError,
  isUndefinedTableError,
} from "@/lib/database/schemaCompat";

export type ShopExceptionRow = {
  work_order_id: string;
  work_order_number: string;
  customer_name: string;
  kinds: ShopExceptionKind[];
};

const KIND_LABEL: Record<ShopExceptionKind, string> = {
  stalled: "Stalled",
  promise_missed: "Promise missed",
  unbilled: "Finished and not invoiced",
  unpaid: "Invoiced and unpaid",
  thin_margin: "Parts margin under 20%",
  supplier_credit: "Supplier credit waiting",
};

export function shopExceptionLabel(kind: ShopExceptionKind): string {
  return KIND_LABEL[kind];
}

export async function listShopExceptions(): Promise<ShopExceptionRow[]> {
  const user = await requireUser();
  if (!canViewReports(user.role)) throw new Error("FORBIDDEN");
  const supabase = await createClient();
  const locationId = user.active_location_id!;
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("work_order")
    .select(
      `
      work_order_id, work_order_number, status, estimated_completion, updated_at,
      billing_stage, billing_amount_cents, billing_collected_cents,
      customer:customer_id ( first_name, last_name ),
      jobs:job ( started_at, updated_at, created_at )
    `
    )
    .eq("location_id", locationId)
    .neq("status", "cancelled")
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) throw error;

  const ids = ((data ?? []) as Array<{ work_order_id: string }>).map(
    (row) => row.work_order_id
  );
  const costByWo = new Map<string, { sell: number; cost: number | null }>();
  const creditByWo = new Map<string, number>();

  if (ids.length > 0) {
    const { data: parts, error: partError } = await supabase
      .from("part")
      .select("unit_price, quantity, job:job_id!inner ( work_order_id )")
      .in("job.work_order_id", ids);
    if (partError) throw partError;
    for (const part of (parts ?? []) as Array<Record<string, unknown>>) {
      const job = part.job as { work_order_id?: string } | null;
      const workOrderId = job?.work_order_id;
      if (!workOrderId) continue;
      const slot = costByWo.get(workOrderId) ?? { sell: 0, cost: null };
      const price = Number(part.unit_price ?? 0);
      const qty = Number(part.quantity ?? 1);
      slot.sell += Math.round(price * qty * 100);
      costByWo.set(workOrderId, slot);
    }

    const { data: lines, error: lineError } = await supabase
      .from("purchase_order_line")
      .select(
        `
        unit_cost_cents, quantity_ordered, supplier_credit_cents, credit_recovered_at,
        requirement:requirement_id!inner ( quantity_received, job:job_id!inner ( work_order_id ) )
      `
      )
      .in("requirement.job.work_order_id", ids);
    if (
      lineError &&
      !isUndefinedTableError(lineError, "purchase_order_line") &&
      !isUndefinedColumnError(lineError)
    ) {
      throw lineError;
    }
    for (const line of (lines ?? []) as Array<Record<string, unknown>>) {
      const requirement = line.requirement as {
        quantity_received?: number | null;
        job?: { work_order_id?: string };
      } | null;
      const workOrderId = requirement?.job?.work_order_id;
      if (!workOrderId) continue;
      if (
        line.credit_recovered_at == null &&
        Number(line.supplier_credit_cents ?? 0) > 0
      ) {
        creditByWo.set(
          workOrderId,
          (creditByWo.get(workOrderId) ?? 0) + Number(line.supplier_credit_cents ?? 0)
        );
      }
      if (line.unit_cost_cents == null) continue;
      const slot = costByWo.get(workOrderId) ?? { sell: 0, cost: 0 };
      slot.cost =
        (slot.cost ?? 0) +
        Number(line.unit_cost_cents) * Number(requirement?.quantity_received ?? 0);
      costByWo.set(workOrderId, slot);
    }
  }

  const rows: ShopExceptionRow[] = [];
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const id = String(row.work_order_id);
    const jobs =
      (row.jobs as Array<{
        started_at?: string | null;
        updated_at?: string | null;
        created_at?: string | null;
      }>) ?? [];
    const lastJobActivityAt =
      jobs
        .flatMap((job) => [job.updated_at, job.started_at, job.created_at])
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ??
      (row.updated_at as string | null) ??
      null;
    const money = costByWo.get(id) ?? { sell: 0, cost: null };
    const customer = row.customer as { first_name?: string; last_name?: string } | null;
    const kinds = classifyShopExceptions({
      status: row.status as WorkOrderStatus,
      lastJobActivityAt,
      estimatedCompletion: (row.estimated_completion as string | null) ?? null,
      billingStage: (row.billing_stage as BillingStage | null) ?? "none",
      billingAmountCents: Number(row.billing_amount_cents ?? 0),
      billingCollectedCents: Number(row.billing_collected_cents ?? 0),
      partsMarginThin: thinPartsMargin({ sellCents: money.sell, costCents: money.cost }),
      supplierCreditCents: creditByWo.get(id) ?? 0,
      now,
    });
    if (kinds.length === 0) continue;
    rows.push({
      work_order_id: id,
      work_order_number: String(row.work_order_number ?? ""),
      customer_name:
        `${customer?.first_name ?? ""} ${customer?.last_name ?? ""}`.trim() || "Customer",
      kinds,
    });
  }
  return rows;
}
