import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { canOrderPart } from "@/lib/permissions";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import {
  invoiceCheck,
  requirementStateAfterReceipt,
  type InvoiceCheck,
} from "@/lib/purchasing/controls";
import {
  isUndefinedColumnError,
  isUndefinedTableError,
} from "@/lib/database/schemaCompat";

export type OpenPartForOrder = {
  part_id: string;
  part_name: string;
  quantity: number;
  job_id: string;
  work_order_id: string;
  work_order_number: string;
  status: string;
};

export type PurchaseOrderView = {
  purchase_order_id: string;
  supplier: string;
  external_po_number: string | null;
  status: string;
  expected_at: string | null;
  supplier_invoice_number: string | null;
  supplier_invoice_total_cents: number | null;
  freight_cents: number;
  invoice_check: InvoiceCheck;
  lines: Array<{
    po_line_id: string;
    description: string;
    quantity_ordered: number;
    quantity_received: number;
    quantity_returned: number;
    unit_cost_cents: number | null;
    supplier_credit_cents: number;
    core_deadline: string | null;
    requirement_id: string | null;
    fitment_confirmed_at: string | null;
    install_task_id: string | null;
  }>;
};

async function requireBuyer() {
  const user = await requireUser();
  if (!canOrderPart(user.role)) throw new Error("FORBIDDEN");
  if (!user.active_location_id) throw new Error("NO_LOCATION");
  return { user, supabase: await createClient(), locationId: user.active_location_id };
}

export async function listOpenPartsToOrder(): Promise<OpenPartForOrder[]> {
  const { supabase, locationId } = await requireBuyer();
  const { data, error } = await supabase
    .from("part")
    .select(
      `
      part_id, part_name, quantity, status, job_id,
      job:job_id ( work_order_id, work_order:work_order_id ( work_order_number, location_id, status ) )
    `
    )
    .in("status", ["needed", "ordered"])
    .limit(100);
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>)
    .map((row) => {
      const job = row.job as {
        work_order_id?: string;
        work_order?: {
          work_order_number?: string;
          location_id?: string;
          status?: string;
        };
      } | null;
      return {
        part_id: String(row.part_id),
        part_name: String(row.part_name),
        quantity: Number(row.quantity ?? 1),
        job_id: String(row.job_id),
        work_order_id: job?.work_order_id ?? "",
        work_order_number: job?.work_order?.work_order_number ?? "",
        status: String(row.status),
        location_id: job?.work_order?.location_id,
        wo_status: job?.work_order?.status,
      };
    })
    .filter(
      (row) =>
        row.location_id === locationId &&
        row.wo_status !== "completed" &&
        row.wo_status !== "cancelled" &&
        row.work_order_id
    )
    .map(({ location_id: _location, wo_status: _status, ...row }) => row);
}

export async function listPurchaseOrders(): Promise<PurchaseOrderView[]> {
  const { supabase, locationId } = await requireBuyer();
  const { data, error } = await supabase
    .from("purchase_order")
    .select(
      `
      purchase_order_id, supplier, external_po_number, status, expected_at,
      supplier_invoice_number, supplier_invoice_total_cents, freight_cents,
      lines:purchase_order_line (
        po_line_id, description, quantity_ordered, unit_cost_cents, requirement_id,
        quantity_returned, supplier_credit_cents, core_deadline,
        requirement:requirement_id ( quantity_received, fitment_confirmed_at )
      )
    `
    )
    .eq("location_id", locationId)
    .order("created_at", { ascending: false })
    .limit(40);
  if (error) {
    if (isUndefinedColumnError(error) || isUndefinedTableError(error, "purchase_order")) {
      throw new Error("ACCOUNTABILITY_NOT_MIGRATED");
    }
    throw error;
  }

  const requirementIds = ((data ?? []) as Array<Record<string, unknown>>).flatMap((po) =>
    ((po.lines as Array<{ requirement_id?: string | null }>) ?? [])
      .map((line) => line.requirement_id)
      .filter((id): id is string => Boolean(id))
  );
  const taskByRequirement = new Map<string, string>();
  if (requirementIds.length > 0) {
    const { data: tasks } = await supabase
      .from("install_task")
      .select("install_task_id, requirement_id")
      .in("requirement_id", requirementIds);
    for (const task of (tasks ?? []) as Array<{
      install_task_id: string;
      requirement_id: string;
    }>) {
      taskByRequirement.set(task.requirement_id, task.install_task_id);
    }
  }

  return ((data ?? []) as Array<Record<string, unknown>>).map((po) => {
    const lines = ((po.lines as Array<Record<string, unknown>>) ?? []).map((line) => {
      const requirement = line.requirement as {
        quantity_received?: number | null;
        fitment_confirmed_at?: string | null;
      } | null;
      return {
        po_line_id: String(line.po_line_id),
        description: String(line.description),
        quantity_ordered: Number(line.quantity_ordered ?? 0),
        quantity_received: Number(requirement?.quantity_received ?? 0),
        quantity_returned: Number(line.quantity_returned ?? 0),
        unit_cost_cents:
          line.unit_cost_cents == null ? null : Number(line.unit_cost_cents),
        supplier_credit_cents: Number(line.supplier_credit_cents ?? 0),
        core_deadline: (line.core_deadline as string | null) ?? null,
        requirement_id: (line.requirement_id as string | null) ?? null,
        fitment_confirmed_at: requirement?.fitment_confirmed_at ?? null,
        install_task_id: line.requirement_id
          ? (taskByRequirement.get(String(line.requirement_id)) ?? null)
          : null,
      };
    });
    const costComplete = lines.every((line) => line.unit_cost_cents != null);
    const receivedCost = lines.reduce(
      (sum, line) => sum + (line.unit_cost_cents ?? 0) * line.quantity_received,
      0
    );
    return {
      purchase_order_id: String(po.purchase_order_id),
      supplier: String(po.supplier),
      external_po_number: (po.external_po_number as string | null) ?? null,
      status: String(po.status),
      expected_at: (po.expected_at as string | null) ?? null,
      supplier_invoice_number: (po.supplier_invoice_number as string | null) ?? null,
      supplier_invoice_total_cents:
        po.supplier_invoice_total_cents == null
          ? null
          : Number(po.supplier_invoice_total_cents),
      freight_cents: Number(po.freight_cents ?? 0),
      invoice_check: invoiceCheck({
        invoiceTotalCents:
          po.supplier_invoice_total_cents == null
            ? null
            : Number(po.supplier_invoice_total_cents),
        receivedCostCents: receivedCost,
        freightCents: Number(po.freight_cents ?? 0),
        costComplete,
      }),
      lines,
    };
  });
}

export async function createPurchaseOrder(input: {
  supplier: string;
  expectedAt: string | null;
  externalPoNumber: string | null;
  partIds: string[];
  unitCostCents: number;
}): Promise<void> {
  const supplier = input.supplier.trim();
  if (!supplier) throw new Error("SUPPLIER_REQUIRED");
  if (input.partIds.length === 0) throw new Error("PO_LINES_REQUIRED");
  const { user, supabase, locationId } = await requireBuyer();

  const { data: parts, error: partError } = await supabase
    .from("part")
    .select("part_id, part_name, quantity, job_id, part_number")
    .in("part_id", input.partIds);
  if (partError) throw partError;
  if (!parts || parts.length === 0) throw new Error("PO_LINES_REQUIRED");

  const { data: po, error: poError } = await supabase
    .from("purchase_order")
    .insert({
      location_id: locationId,
      supplier,
      external_po_number: input.externalPoNumber?.trim() || null,
      status: "submitted",
      ordered_at: new Date().toISOString(),
      expected_at: input.expectedAt,
      created_by_user_id: user.user_id,
      freight_cents: 0,
    })
    .select("purchase_order_id")
    .single();
  if (poError) throw poError;

  for (const part of parts) {
    const { data: existing } = await supabase
      .from("job_part_requirement")
      .select("requirement_id")
      .eq("part_id", part.part_id)
      .maybeSingle();
    let requirementId = existing?.requirement_id as string | undefined;
    if (!requirementId) {
      const { data: created, error: reqError } = await supabase
        .from("job_part_requirement")
        .insert({
          job_id: part.job_id,
          part_id: part.part_id,
          description: part.part_name,
          part_number: part.part_number,
          quantity_required: part.quantity,
          state: "ordered",
        })
        .select("requirement_id")
        .single();
      if (reqError) throw reqError;
      requirementId = created.requirement_id as string;
    } else {
      await supabase
        .from("job_part_requirement")
        .update({ state: "ordered", updated_at: new Date().toISOString() })
        .eq("requirement_id", requirementId);
    }
    const { error: lineError } = await supabase.from("purchase_order_line").insert({
      purchase_order_id: po.purchase_order_id,
      requirement_id: requirementId,
      description: part.part_name,
      quantity_ordered: part.quantity,
      unit_cost_cents: input.unitCostCents,
    });
    if (lineError) throw lineError;
    await supabase.from("part").update({ status: "ordered" }).eq("part_id", part.part_id);
  }

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: locationId,
    action: "purchase_order_created",
    entity_type: "purchase_order",
    entity_id: po.purchase_order_id as string,
    description: `Purchase order sent to ${supplier}`,
    new_value: { part_ids: input.partIds },
  });
}

export async function receivePurchaseLine(
  poLineId: string,
  quantity: number
): Promise<void> {
  if (!Number.isFinite(quantity) || quantity <= 0)
    throw new Error("RECEIPT_QUANTITY_INVALID");
  const { user, supabase, locationId } = await requireBuyer();
  const { data: line, error } = await supabase
    .from("purchase_order_line")
    .select(
      `
      po_line_id, description, quantity_ordered, requirement_id,
      purchase_order:purchase_order_id ( location_id, purchase_order_id ),
      requirement:requirement_id ( requirement_id, quantity_received, quantity_required, job_id, part_id, job:job_id ( work_order_id, assigned_technician_id ) )
    `
    )
    .eq("po_line_id", poLineId)
    .maybeSingle();
  if (error) throw error;
  if (!line) throw new Error("PO_LINE_NOT_FOUND");
  const po = line.purchase_order as {
    location_id?: string;
    purchase_order_id?: string;
  } | null;
  if (po?.location_id !== locationId) throw new Error("FOREIGN_LOCATION");

  const { error: receiptError } = await supabase.from("part_receipt").insert({
    po_line_id: poLineId,
    quantity_received: quantity,
    received_by_user_id: user.user_id,
  });
  if (receiptError) throw receiptError;

  const requirement = line.requirement as {
    requirement_id?: string;
    quantity_received?: number | null;
    part_id?: string | null;
    job?: { work_order_id?: string; assigned_technician_id?: string | null };
  } | null;
  const received = Number(requirement?.quantity_received ?? 0) + quantity;
  const ordered = Number(line.quantity_ordered ?? 0);
  const state = requirementStateAfterReceipt({
    quantityOrdered: ordered,
    quantityReceived: received,
  });
  if (requirement?.requirement_id) {
    await supabase
      .from("job_part_requirement")
      .update({
        quantity_received: received,
        state: state === "ordered" ? "partially_received" : state,
        updated_at: new Date().toISOString(),
      })
      .eq("requirement_id", requirement.requirement_id);
    const workOrderId = requirement.job?.work_order_id;
    if (workOrderId) {
      await supabase.from("install_task").upsert(
        {
          requirement_id: requirement.requirement_id,
          work_order_id: workOrderId,
          location_id: locationId,
          assigned_technician_id: requirement.job?.assigned_technician_id ?? null,
          description: `Install ${line.description}`,
        },
        { onConflict: "requirement_id", ignoreDuplicates: true }
      );
    }
    if (requirement.part_id && state === "received") {
      await supabase
        .from("part")
        .update({ status: "in_stock" })
        .eq("part_id", requirement.part_id);
    }
  }

  const nextStatus = state === "received" ? "received" : "partially_received";
  await supabase
    .from("purchase_order")
    .update({
      status: nextStatus,
      received_at: state === "received" ? new Date().toISOString() : null,
    })
    .eq("purchase_order_id", po?.purchase_order_id ?? "");

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: locationId,
    action: "part_received",
    entity_type: "purchase_order_line",
    entity_id: poLineId,
    description: `Received ${quantity} of ${line.description}. Install task created. Customer was not told the bike is ready.`,
    new_value: { quantity, state },
  });
}

export async function recordSupplierInvoice(input: {
  purchaseOrderId: string;
  invoiceNumber: string;
  invoiceTotalCents: number;
  freightCents: number;
}): Promise<void> {
  const { user, supabase, locationId } = await requireBuyer();
  const { error } = await supabase
    .from("purchase_order")
    .update({
      supplier_invoice_number: input.invoiceNumber.trim() || null,
      supplier_invoice_total_cents: input.invoiceTotalCents,
      freight_cents: input.freightCents,
    })
    .eq("purchase_order_id", input.purchaseOrderId)
    .eq("location_id", locationId);
  if (error) throw error;
  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: locationId,
    action: "supplier_invoice_recorded",
    entity_type: "purchase_order",
    entity_id: input.purchaseOrderId,
    description: "Supplier invoice recorded against received cost and freight",
    new_value: {
      invoice_total_cents: input.invoiceTotalCents,
      freight_cents: input.freightCents,
    },
  });
}

export async function recordSupplierReturn(input: {
  poLineId: string;
  quantityReturned: number;
  supplierCreditCents: number;
  coreDeadline: string | null;
}): Promise<void> {
  const { user, supabase, locationId } = await requireBuyer();
  const { error } = await supabase
    .from("purchase_order_line")
    .update({
      quantity_returned: input.quantityReturned,
      supplier_credit_cents: input.supplierCreditCents,
      core_deadline: input.coreDeadline,
      returned_at: new Date().toISOString(),
    })
    .eq("po_line_id", input.poLineId);
  if (error) throw error;
  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: locationId,
    action: "supplier_return_recorded",
    entity_type: "purchase_order_line",
    entity_id: input.poLineId,
    description: "Supplier return, core deadline, or credit recorded",
    new_value: input,
  });
}

export async function confirmPartFitment(requirementId: string): Promise<void> {
  const { user, supabase } = await requireBuyer();
  const { error } = await supabase
    .from("job_part_requirement")
    .update({
      fitment_confirmed_at: new Date().toISOString(),
      fitment_confirmed_by_user_id: user.user_id,
      updated_at: new Date().toISOString(),
    })
    .eq("requirement_id", requirementId);
  if (error) throw error;
}
