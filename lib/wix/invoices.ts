import { getWixContactsConfig } from "@/lib/wix/config";
import type {
  WixCreateInvoiceRequest,
  WixCreateInvoiceResponse,
  WixInvoiceLineItem,
} from "@/lib/wix/types";

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

function formatPrice(value: number): string {
  const n = Number.isFinite(value) ? Math.max(0, value) : 0;
  // Payment Links DECIMAL_VALUE — avoid trailing float noise.
  return (Math.round(n * 1000) / 1000).toFixed(2);
}

/**
 * Create a Wix Payment Link (ECOM + custom line items) for a work order.
 * Prefer this over the legacy Velo invoice HTTP bridge.
 */
export async function createWixPaymentLink(
  payload: WixCreateInvoiceRequest
): Promise<WixCreateInvoiceResponse> {
  const { apiKey, siteId, accountId, currency } = getWixContactsConfig();
  const useCurrency = payload.currency || currency;

  const lineItems = payload.lineItems
    .filter((item) => item.quantity > 0)
    .map((item) => ({
      type: "CUSTOM",
      customItem: {
        name: item.name.slice(0, 200),
        description: (item.description ?? "").slice(0, 600) || undefined,
        quantity: Math.min(100000, Math.max(1, Math.round(item.quantity))),
        price: formatPrice(item.price),
      },
    }));

  if (lineItems.length === 0) {
    throw new Error("WIX_INVOICE_NO_LINE_ITEMS");
  }

  const recipients = payload.contactId
    ? [
        {
          contactId: payload.contactId,
          sendMethods: payload.email ? ["EMAIL_METHOD"] : [],
        },
      ]
    : undefined;

  const body = {
    paymentLink: {
      title: payload.title.slice(0, 200),
      description: `OTOMOTO ${payload.workOrderNumber}`.slice(0, 500),
      currency: useCurrency,
      type: "ECOM",
      paymentsLimit: 1,
      recipients,
      note: {
        text: `OTOMOTO work order ${payload.workOrderNumber}`.slice(0, 500),
      },
      ecomPaymentLink: { lineItems },
    },
  };

  const headers: Record<string, string> = {
    Authorization: apiKey,
    "wix-site-id": siteId,
    "Content-Type": "application/json",
  };
  if (accountId) headers["wix-account-id"] = accountId;

  const response = await fetch(
    "https://www.wixapis.com/payment-links/v1/payment-links",
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      cache: "no-store",
    }
  );

  if (!response.ok) {
    let detail = `WIX_INVOICE_HTTP_${response.status}`;
    try {
      const err = (await response.json()) as {
        message?: string;
        details?: { applicationError?: { description?: string; code?: string } };
      };
      detail =
        err.details?.applicationError?.description ||
        err.details?.applicationError?.code ||
        err.message ||
        detail;
    } catch {
      /* keep status */
    }
    throw new Error(detail);
  }

  const data = (await response.json()) as {
    paymentLink?: {
      id?: string;
      links?: { url?: { url?: string; base?: string; path?: string } };
      displayData?: { title?: string };
    };
  };

  const invoiceId = data.paymentLink?.id;
  if (!invoiceId) throw new Error("WIX_INVOICE_INVALID_RESPONSE");

  const url =
    data.paymentLink?.links?.url?.url ||
    data.paymentLink?.links?.url?.base ||
    null;

  return {
    invoiceId,
    invoiceNumber: payload.workOrderNumber,
    paymentLinkUrl: url,
  };
}

/** @deprecated Prefer createWixPaymentLink — kept for optional Velo bridge. */
export async function createWixInvoiceViaBridge(
  payload: WixCreateInvoiceRequest
): Promise<WixCreateInvoiceResponse> {
  return createWixPaymentLink(payload);
}
