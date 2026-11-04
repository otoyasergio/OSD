/** 20 percent. Rows stay off the exception list until received cost is known. */
export const PARTS_MARGIN_FLOOR_BPS = 2000;

export function requirementStateAfterReceipt(input: {
  quantityOrdered: number;
  quantityReceived: number;
}): "ordered" | "partially_received" | "received" {
  if (input.quantityReceived <= 0) return "ordered";
  if (input.quantityReceived < input.quantityOrdered) return "partially_received";
  return "received";
}

/** A purchase order is received only when every line has its full quantity. */
export function purchaseOrderStatusAfterReceipt(
  lines: Array<{ ordered: number; received: number }>
): "partially_received" | "received" {
  if (lines.length === 0) return "partially_received";
  return lines.every((line) => line.received >= line.ordered)
    ? "received"
    : "partially_received";
}

export function promiseAssumesFullDelivery(input: {
  hasPromise: boolean;
  lines: Array<{ ordered: number; received: number }>;
}): boolean {
  if (!input.hasPromise) return false;
  return input.lines.some((line) => line.received < line.ordered);
}

export type InvoiceCheck = "unset" | "match" | "mismatch" | "cost_missing";

export function invoiceCheck(input: {
  invoiceTotalCents: number | null;
  receivedCostCents: number;
  freightCents: number;
  costComplete: boolean;
}): InvoiceCheck {
  if (input.invoiceTotalCents == null) return "unset";
  if (!input.costComplete) return "cost_missing";
  const expected = input.receivedCostCents + input.freightCents;
  return input.invoiceTotalCents === expected ? "match" : "mismatch";
}

/** Null when acquisition cost has not been recorded. */
export function partsMarginBps(input: {
  sellCents: number;
  costCents: number | null;
}): number | null {
  if (input.costCents == null || input.sellCents <= 0) return null;
  return Math.round(((input.sellCents - input.costCents) / input.sellCents) * 10000);
}

export function thinPartsMargin(input: {
  sellCents: number;
  costCents: number | null;
}): boolean {
  const margin = partsMarginBps(input);
  if (margin == null) return false;
  return margin < PARTS_MARGIN_FLOOR_BPS;
}
