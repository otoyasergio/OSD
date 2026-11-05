import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import type { DbClient } from "@/lib/database/types";
import { canOrderPart } from "@/lib/permissions";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import {
  invoiceCheck,
  purchaseOrderStatusAfterReceipt,
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

export type PurchaseOrderLineView = {
  po_line_id: string;
  description: string;
  quantity_ordered: number;
  quantity_received: number;
  quantity_returned: number;
  unit_cost_cents: number | null;
  supplier_credit_cents: number;
  credit_recovered_at: string | null;
  core_deadline: string | null;
  requirement_id: string | null;
  fitment_confirmed_at: string | null;
  install_task_id: string | null;
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
  lines: PurchaseOrderLineView[];
};

export type PurchaseOrderLineInput = {
  partId: string;
  /** Null until the supplier confirms the price. */
  unitCostCents: number | null;
};

async function requireBuyer() {
  const user = await requireUser();
  if (!canOrderPart(user.role)) throw new Error("FORBIDDEN");
  if (!user.active_location_id) throw new Error("NO_LOCATION");
  return { user, supabase: await createClient(), locationId: user.active_location_id };
}

function sumReceipts(receipts: unknown): number {
  return ((receipts as Array<{ quantity_received?: number | null }> | null) ?? []).reduce(
    (sum, receipt) => sum + Number(receipt.quantity_received ?? 0),
    0
  );
}

const LINE_WITH_PO = `
  po_line_id, description, quantity_ordered, quantity_returned, supplier_credit_cents, requirement_id,
  purchase_order:purchase_order_id!inner ( purchase_order_id, location_id )
`;

/** A purchase order line that belongs to the buyer's active location. */
async function loadLineForBuyer(
  supabase: DbClient,
  poLineId: string,
  locationId: string
) {
  const { data, error } = await supabase
    .from("purchase_order_line")
    .select(LINE_WITH_PO)
    .eq("po_line_id", poLineId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("PO_LINE_NOT_FOUND");
  const line = data as unknown as {
    po_line_id: string;
    description: string;
    quantity_ordered: number;
    quantity_returned: number;
    supplier_credit_cents: number;
    requirement_id: string | null;
    purchase_order: { purchase_order_id: string; location_id: string } | null;
  };
  if (line.purchase_order?.location_id !== locationId)
    throw new Error("FOREIGN_LOCATION");
  return line;
}

export async function listOpenPartsToOrder(): Promise<OpenPartForOrder[]> {
  const { supabase, locationId } = await requireBuyer();
  const { data, error } = await supabase
    .from("part")
    .select(
      `
      part_id, part_name, quantity, status, job_id,
      job:job_id!inner (
        work_order_id,
        work_order:work_order_id!inner ( work_order_number, location_id, status )
      )
    `
    )
    .in("status", ["needed", "ordered"])
    .eq("job.work_order.location_id", locationId)
    .not("job.work_order.status", "in", '("completed","cancelled")')
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const job = row.job as {
      work_order_id?: string;
      work_order?: { work_order_number?: string };
    } | null;
    return {
      part_id: String(row.part_id),
      part_name: String(row.part_name),
      quantity: Number(row.quantity ?? 1),
      job_id: String(row.job_id),
      work_order_id: job?.work_order_id ?? "",
      work_order_number: job?.work_order?.work_order_number ?? "",
      status: String(row.status),
    };
  });
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
        quantity_returned, supplier_credit_cents, credit_recovered_at, core_deadline,
        receipts:part_receipt ( quantity_received ),
        requirement:requirement_id ( fitment_confirmed_at )
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
    const { data: tasks, error: taskError } = await supabase
      .from("install_task")
      .select("install_task_id, requirement_id")
      .in("requirement_id", requirementIds);
    if (taskError && !isUndefinedTableError(taskError, "install_task")) throw taskError;
    for (const task of (tasks ?? []) as Array<{
      install_task_id: string;
      requirement_id: string;
    }>) {
      taskByRequirement.set(task.requirement_id, task.install_task_id);
    }
  }

  return ((data ?? []) as Array<Record<string, unknown>>).map((po) => {
    const lines: PurchaseOrderLineView[] = (
      (po.lines as Array<Record<string, unknown>>) ?? []
    ).map((line) => {
      const requirement = line.requirement as {
        fitment_confirmed_at?: string | null;
      } | null;
      return {
        po_line_id: String(line.po_line_id),
        description: String(line.description),
        quantity_ordered: Number(line.quantity_ordered ?? 0),
        quantity_received: sumReceipts(line.receipts),
        quantity_returned: Number(line.quantity_returned ?? 0),
        unit_cost_cents:
          line.unit_cost_cents == null ? null : Number(line.unit_cost_cents),
        supplier_credit_cents: Number(line.supplier_credit_cents ?? 0),
        credit_recovered_at: (line.credit_recovered_at as string | null) ?? null,
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
    const invoiceTotal =
      po.supplier_invoice_total_cents == null
        ? null
        : Number(po.supplier_invoice_total_cents);
    return {
      purchase_order_id: String(po.purchase_order_id),
      supplier: String(po.supplier),
      external_po_number: (po.external_po_number as string | null) ?? null,
      status: String(po.status),
      expected_at: (po.expected_at as string | null) ?? null,
      supplier_invoice_number: (po.supplier_invoice_number as string | null) ?? null,
      supplier_invoice_total_cents: invoiceTotal,
      freight_cents: Number(po.freight_cents ?? 0),
      invoice_check: invoiceCheck({
        invoiceTotalCents: invoiceTotal,
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
  lines: PurchaseOrderLineInput[];
}): Promise<void> {
  const supplier = input.supplier.trim();
  if (!supplier) throw new Error("SUPPLIER_REQUIRED");
  if (input.lines.length === 0) throw new Error("PO_LINES_REQUIRED");
  const { user, supabase, locationId } = await requireBuyer();

  const costByPart = new Map(
    input.lines.map((line) => [line.partId, line.unitCostCents])
  );
  const { data: parts, error: partError } = await supabase
    .from("part")
    .select(
      `
      part_id, part_name, quantity, job_id, part_number,
      job:job_id!inner ( work_order:work_order_id!inner ( location_id ) )
    `
    )
    .in("part_id", [...costByPart.keys()]);
  if (partError) throw partError;
  const partRows = (parts ?? []) as unknown as Array<{
    part_id: string;
    part_name: string;
    quantity: number;
    job_id: string;
    part_number: string | null;
    job: { work_order: { location_id: string } | null } | null;
  }>;
  if (partRows.length !== costByPart.size) throw new Error("PART_NOT_FOUND");
  if (partRows.some((part) => part.job?.work_order?.location_id !== locationId)) {
    throw new Error("FOREIGN_LOCATION");
  }

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

  for (const part of partRows) {
    const { data: existing, error: existingError } = await supabase
      .from("job_part_requirement")
      .select("requirement_id")
      .eq("part_id", part.part_id)
      .maybeSingle();
    if (existingError) throw existingError;
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
      const { error: stateError } = await supabase
        .from("job_part_requirement")
        .update({ state: "ordered", updated_at: new Date().toISOString() })
        .eq("requirement_id", requirementId);
      if (stateError) throw stateError;
    }
    const { error: lineError } = await supabase.from("purchase_order_line").insert({
      purchase_order_id: po.purchase_order_id,
      requirement_id: requirementId,
      description: part.part_name,
      quantity_ordered: part.quantity,
      unit_cost_cents: costByPart.get(part.part_id) ?? null,
    });
    if (lineError) throw lineError;
    const { error: partStatusError } = await supabase
      .from("part")
      .update({ status: "ordered" })
      .eq("part_id", part.part_id);
    if (partStatusError) throw partStatusError;
  }

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: locationId,
    action: "purchase_order_created",
    entity_type: "purchase_order",
    entity_id: po.purchase_order_id as string,
    description: `Purchase order sent to ${supplier}`,
    new_value: { part_ids: [...costByPart.keys()] },
  });
}

export async function receivePurchaseLine(
  poLineId: string,
  quantity: number
): Promise<void> {
  if (!Number.isFinite(quantity) || quantity <= 0)
    throw new Error("RECEIPT_QUANTITY_INVALID");
  const { user, supabase, locationId } = await requireBuyer();
  const line = await loadLineForBuyer(supabase, poLineId, locationId);
  const purchaseOrderId = line.purchase_order!.purchase_order_id;

  const { error: receiptError } = await supabase.from("part_receipt").insert({
    po_line_id: poLineId,
    quantity_received: quantity,
    received_by_user_id: user.user_id,
  });
  if (receiptError) throw receiptError;

  let state: ReturnType<typeof requirementStateAfterReceipt> = "partially_received";
  if (line.requirement_id) {
    const { data: requirementRow, error: requirementError } = await supabase
      .from("job_part_requirement")
      .select(
        "requirement_id, quantity_received, quantity_required, part_id, job:job_id ( work_order_id, assigned_technician_id )"
      )
      .eq("requirement_id", line.requirement_id)
      .maybeSingle();
    if (requirementError) throw requirementError;
    const requirement = requirementRow as {
      requirement_id: string;
      quantity_received: number | null;
      quantity_required: number | null;
      part_id: string | null;
      job: { work_order_id?: string; assigned_technician_id?: string | null } | null;
    } | null;
    if (requirement) {
      const received = Number(requirement.quantity_received ?? 0) + quantity;
      state = requirementStateAfterReceipt({
        quantityOrdered: Number(requirement.quantity_required ?? line.quantity_ordered),
        quantityReceived: received,
      });
      const { error: stateError } = await supabase
        .from("job_part_requirement")
        .update({
          quantity_received: received,
          state,
          updated_at: new Date().toISOString(),
        })
        .eq("requirement_id", requirement.requirement_id);
      if (stateError) throw stateError;

      const workOrderId = requirement.job?.work_order_id;
      if (workOrderId) {
        const { error: taskError } = await supabase.from("install_task").upsert(
          {
            requirement_id: requirement.requirement_id,
            work_order_id: workOrderId,
            location_id: locationId,
            assigned_technician_id: requirement.job?.assigned_technician_id ?? null,
            description: `Install ${line.description}`,
          },
          { onConflict: "requirement_id", ignoreDuplicates: true }
        );
        if (taskError) throw taskError;
      }
      if (requirement.part_id && state === "received") {
        const { error: partError } = await supabase
          .from("part")
          .update({ status: "in_stock" })
          .eq("part_id", requirement.part_id);
        if (partError) throw partError;
      }
    }
  }

  const { data: poLines, error: poLinesError } = await supabase
    .from("purchase_order_line")
    .select("quantity_ordered, receipts:part_receipt ( quantity_received )")
    .eq("purchase_order_id", purchaseOrderId);
  if (poLinesError) throw poLinesError;
  const poStatus = purchaseOrderStatusAfterReceipt(
    ((poLines ?? []) as Array<Record<string, unknown>>).map((row) => ({
      ordered: Number(row.quantity_ordered ?? 0),
      received: sumReceipts(row.receipts),
    }))
  );
  const poPatch: Record<string, unknown> = { status: poStatus };
  if (poStatus === "received") poPatch.received_at = new Date().toISOString();
  const { error: poError } = await supabase
    .from("purchase_order")
    .update(poPatch)
    .eq("purchase_order_id", purchaseOrderId);
  if (poError) throw poError;

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: locationId,
    action: "part_received",
    entity_type: "purchase_order_line",
    entity_id: poLineId,
    description: `Received ${quantity} of ${line.description}. Install task created. Customer was not told the bike is ready.`,
    new_value: { quantity, state, purchase_order_status: poStatus },
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
  const line = await loadLineForBuyer(supabase, input.poLineId, locationId);
  if (input.quantityReturned > Number(line.quantity_ordered ?? 0)) {
    throw new Error("RETURN_QUANTITY_INVALID");
  }
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

export async function recordSupplierCreditRecovered(poLineId: string): Promise<void> {
  const { user, supabase, locationId } = await requireBuyer();
  const line = await loadLineForBuyer(supabase, poLineId, locationId);
  if (Number(line.supplier_credit_cents ?? 0) <= 0)
    throw new Error("SUPPLIER_CREDIT_NONE");
  const { error } = await supabase
    .from("purchase_order_line")
    .update({ credit_recovered_at: new Date().toISOString() })
    .eq("po_line_id", poLineId);
  if (error) throw error;
  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: locationId,
    action: "supplier_credit_recovered",
    entity_type: "purchase_order_line",
    entity_id: poLineId,
    description: "Supplier credit recovered",
    new_value: { supplier_credit_cents: line.supplier_credit_cents },
  });
}

export async function confirmPartFitment(requirementId: string): Promise<void> {
  const { user, supabase, locationId } = await requireBuyer();
  const { data, error: loadError } = await supabase
    .from("job_part_requirement")
    .select(
      "requirement_id, job:job_id!inner ( work_order:work_order_id!inner ( location_id ) )"
    )
    .eq("requirement_id", requirementId)
    .maybeSingle();
  if (loadError) throw loadError;
  if (!data) throw new Error("REQUIREMENT_NOT_FOUND");
  const requirement = data as unknown as {
    job: { work_order: { location_id: string } | null } | null;
  };
  if (requirement.job?.work_order?.location_id !== locationId) {
    throw new Error("FOREIGN_LOCATION");
  }
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
