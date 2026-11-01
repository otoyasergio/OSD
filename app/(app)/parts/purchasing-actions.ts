"use server";

import { revalidatePath } from "next/cache";
import { toFormErrorMessage } from "@/lib/services/errors";
import {
  confirmPartFitment,
  createPurchaseOrder,
  receivePurchaseLine,
  recordSupplierInvoice,
  recordSupplierReturn,
} from "@/lib/services/purchasing";
import { torontoWallClockToIso } from "@/lib/accountability/torontoTime";

export type PurchasingFormState = { error: string | null; saved: boolean };

const saved: PurchasingFormState = { error: null, saved: true };

function dollarsToCents(raw: string): number {
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount < 0) return -1;
  return Math.round(amount * 100);
}

function fail(error: unknown): PurchasingFormState {
  return { error: toFormErrorMessage(error), saved: false };
}

export async function createPurchaseOrderAction(
  _previous: PurchasingFormState,
  formData: FormData
): Promise<PurchasingFormState> {
  try {
    const expectedRaw = String(formData.get("expected_on") ?? "").trim();
    const expectedAt = expectedRaw ? torontoWallClockToIso(`${expectedRaw}T23:59`) : null;
    if (expectedRaw && !expectedAt)
      return { error: "Enter a valid expected date.", saved: false };
    const unitCostCents = dollarsToCents(String(formData.get("unit_cost_dollars") ?? ""));
    if (unitCostCents < 0)
      return { error: "Enter the unit cost in dollars.", saved: false };
    const partIds = formData
      .getAll("part_id")
      .map((value) => String(value))
      .filter(Boolean);
    await createPurchaseOrder({
      supplier: String(formData.get("supplier") ?? ""),
      expectedAt,
      externalPoNumber: String(formData.get("external_po_number") ?? "") || null,
      partIds,
      unitCostCents,
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
  return saved;
}

export async function recordSupplierInvoiceAction(
  _previous: PurchasingFormState,
  formData: FormData
): Promise<PurchasingFormState> {
  try {
    const invoiceTotalCents = dollarsToCents(
      String(formData.get("invoice_total_dollars") ?? "")
    );
    const freightCents = dollarsToCents(String(formData.get("freight_dollars") ?? "0"));
    if (invoiceTotalCents < 0 || freightCents < 0) {
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
    const creditCents = dollarsToCents(String(formData.get("credit_dollars") ?? "0"));
    const quantity = Number(formData.get("quantity_returned") ?? "");
    if (creditCents < 0 || !Number.isFinite(quantity) || quantity < 0) {
      return {
        error: "Enter the returned quantity and the supplier credit.",
        saved: false,
      };
    }
    const deadlineRaw = String(formData.get("core_deadline") ?? "").trim();
    const coreDeadline = deadlineRaw
      ? torontoWallClockToIso(`${deadlineRaw}T23:59`)
      : null;
    if (deadlineRaw && !coreDeadline)
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
