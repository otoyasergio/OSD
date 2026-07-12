import type {
  WixCreateInvoiceRequest,
  WixCreateInvoiceResponse,
  WixInvoiceLineItem,
} from "@/lib/wix/types";
import { getWixInvoiceBridgeConfig } from "@/lib/wix/config";

const BILLABLE_JOB_STATUSES = new Set([
  "approved",
  "waiting_for_parts",
  "ready_to_start",
  "in_progress",
  "completed",
]);

export function buildInvoiceLineItems(input: {
  workOrderNumber: string;
  jobs: Array<{
    service_name_snapshot: string;
    standard_price_snapshot: number | null;
    status: string;
  }>;
  parts: Array<{
    part_name: string;
    part_number: string | null;
    quantity: number;
    unit_price: number | null;
    status: string;
  }>;
}): WixInvoiceLineItem[] {
  const lines: WixInvoiceLineItem[] = [];

  for (const job of input.jobs) {
    if (!BILLABLE_JOB_STATUSES.has(job.status)) continue;
    const price = Number(job.standard_price_snapshot ?? 0);
    lines.push({
      name: job.service_name_snapshot,
      description: `Labour · ${input.workOrderNumber}`,
      quantity: 1,
      price,
    });
  }

  for (const part of input.parts) {
    if (part.status === "cancelled") continue;
    const unit = Number(part.unit_price ?? 0);
    const qty = Math.max(1, Number(part.quantity) || 1);
    lines.push({
      name: part.part_name,
      description: part.part_number
        ? `Part ${part.part_number} · ${input.workOrderNumber}`
        : `Part · ${input.workOrderNumber}`,
      quantity: qty,
      price: unit,
    });
  }

  return lines;
}

export async function createWixInvoiceViaBridge(
  payload: WixCreateInvoiceRequest
): Promise<WixCreateInvoiceResponse> {
  const { httpUrl, httpSecret } = getWixInvoiceBridgeConfig();

  const response = await fetch(httpUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${httpSecret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  if (!response.ok) {
    let detail = `WIX_INVOICE_HTTP_${response.status}`;
    try {
      const body = (await response.json()) as { error?: string; message?: string };
      detail = body.error || body.message || detail;
    } catch {
      /* keep status code message */
    }
    throw new Error(detail);
  }

  const body = (await response.json()) as WixCreateInvoiceResponse;
  if (!body.invoiceId) {
    throw new Error("WIX_INVOICE_INVALID_RESPONSE");
  }
  return body;
}
