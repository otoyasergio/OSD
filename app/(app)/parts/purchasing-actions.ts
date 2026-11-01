"use server";

import { revalidatePath } from "next/cache";
import { toFormErrorMessage } from "@/lib/services/errors";
import {
  confirmPartFitment,
  createPurchaseOrder,
  receivePurchaseLine,
  recordSupplierCreditRecovered,
  recordSupplierInvoice,
  recordSupplierReturn,
  type PurchaseOrderLineInput,
} from "@/lib/services/purchasing";
import { parseShopLocalDateTimeInput } from "@/lib/datetime/format";
import { parseDollarsToCents } from "@/lib/billing/stages";

export type PurchasingFormState = { error: string | null; saved: boolean };

const saved: PurchasingFormState = { error: null, saved: true };

function fail(error: unknown): PurchasingFormState {
  return { error: toFormErrorMessage(error), saved: false };
}

/** End of a shop day for a date-only field, or null when the field is blank. */
function endOfShopDay(raw: string): string | null | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return parseShopLocalDateTimeInput(`${trimmed}T23:59`)?.toISOString();
}

export async function createPurchaseOrderAction(
  _previous: PurchasingFormState,
  formData: FormData
): Promise<PurchasingFormState> {
  try {
    const expectedAt = endOfShopDay(String(formData.get("expected_on") ?? ""));
    if (expectedAt === undefined)
      return { error: "Enter a valid expected date.", saved: false };
    const lines: PurchaseOrderLineInput[] = [];
    for (const value of formData.getAll("part_id")) {
      const partId = String(value);
      if (!partId) continue;
      const costRaw = String(formData.get(`unit_cost_dollars_${partId}`) ?? "").trim();
      const unitCostCents = costRaw ? parseDollarsToCents(costRaw) : null;
      if (costRaw && unitCostCents == null) throw new Error("PO_LINE_COST_INVALID");
      lines.push({ partId, unitCostCents });
    }
    await createPurchaseOrder({
      supplier: String(formData.get("supplier") ?? ""),
      expectedAt,
      externalPoNumber: String(formData.get("external_po_number") ?? "") || null,
      lines,
    });
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/parts");
  revalidatePath("/advisor");
  return saved;
}

export async function receivePurchaseLineAction(
  _previous: PurchasingFormState,
  formData: FormData
): Promise<PurchasingFormState> {
  try {
    await receivePurchaseLine(
      String(formData.get("po_line_id") ?? ""),
      Number(formData.get("quantity") ?? "")
    );
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/parts");
  revalidatePath("/technician");
  revalidatePath("/technician/docket");
  return saved;
}

export async function recordSupplierInvoiceAction(
  _previous: PurchasingFormState,
  formData: FormData
): Promise<PurchasingFormState> {
  try {
    const invoiceTotalCents = parseDollarsToCents(
      String(formData.get("invoice_total_dollars") ?? "")
    );
    const freightCents = parseDollarsToCents(
      String(formData.get("freight_dollars") ?? "0")
    );
    if (invoiceTotalCents == null || freightCents == null) {
      return { error: "Enter the invoice total and freight in dollars.", saved: false };
    }
    await recordSupplierInvoice({
      purchaseOrderId: String(formData.get("purchase_order_id") ?? ""),
      invoiceNumber: String(formData.get("invoice_number") ?? ""),
      invoiceTotalCents,
      freightCents,
    });
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/parts");
  revalidatePath("/settings/reports");
  return saved;
}

export async function recordSupplierReturnAction(
  _previous: PurchasingFormState,
  formData: FormData
): Promise<PurchasingFormState> {
  try {
    const creditCents = parseDollarsToCents(
      String(formData.get("credit_dollars") ?? "0")
    );
    const quantity = Number(formData.get("quantity_returned") ?? "");
    if (creditCents == null || !Number.isFinite(quantity) || quantity < 0) {
      return {
        error: "Enter the returned quantity and the supplier credit.",
        saved: false,
      };
    }
    const coreDeadline = endOfShopDay(String(formData.get("core_deadline") ?? ""));
    if (coreDeadline === undefined)
      return { error: "Enter a valid core deadline.", saved: false };
    await recordSupplierReturn({
      poLineId: String(formData.get("po_line_id") ?? ""),
      quantityReturned: quantity,
      supplierCreditCents: creditCents,
      coreDeadline,
    });
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/parts");
  revalidatePath("/settings/reports");
  return saved;
}

export async function recordSupplierCreditRecoveredAction(
  _previous: PurchasingFormState,
  formData: FormData
): Promise<PurchasingFormState> {
  try {
    await recordSupplierCreditRecovered(String(formData.get("po_line_id") ?? ""));
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/parts");
  revalidatePath("/settings/reports");
  return saved;
}

export async function confirmPartFitmentAction(
  _previous: PurchasingFormState,
  formData: FormData
): Promise<PurchasingFormState> {
  try {
    await confirmPartFitment(String(formData.get("requirement_id") ?? ""));
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/parts");
  return saved;
}
