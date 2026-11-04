import "server-only";

import { getWixContactsConfig } from "@/lib/wix/config";
import type { WixInvoiceRecord } from "@/lib/wix/invoicePayload";

const WIX_API_BASE = "https://www.wixapis.com";

export class WixInvoiceApiError extends Error {
  status: number;
  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
    this.name = "WixInvoiceApiError";
  }
}

async function invoiceFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { apiKey, siteId, accountId } = getWixContactsConfig();
  const headers = new Headers(init.headers);
  headers.set("Authorization", apiKey);
  headers.set("wix-site-id", siteId);
  headers.set("Content-Type", "application/json");
  if (accountId) headers.set("wix-account-id", accountId);
  return fetch(`${WIX_API_BASE}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(20_000),
  });
}

async function readError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const body = JSON.parse(text) as {
      message?: string;
      details?: { applicationError?: { code?: string; description?: string } };
    };
    return (
      body.details?.applicationError?.description ||
      body.details?.applicationError?.code ||
      body.message ||
      `WIX_HTTP_${response.status}`
    );
  } catch {
    return text.slice(0, 300) || `WIX_HTTP_${response.status}`;
  }
}

async function parseOk<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new WixInvoiceApiError(response.status, await readError(response));
  }
  if (response.status === 204) return {} as T;
  return (await response.json()) as T;
}

export async function getLatestInvoiceNumber(prefix?: string): Promise<number> {
  const query = prefix ? `?prefix=${encodeURIComponent(prefix)}` : "";
  const response = await invoiceFetch(`/invoices/v4/invoices/get-latest-number${query}`);
  const body = await parseOk<{ number?: number }>(response);
  if (typeof body.number !== "number") {
    throw new WixInvoiceApiError(response.status, "Wix did not return a latest invoice number.");
  }
  return body.number;
}

export async function createWixInvoice(
  invoice: Record<string, unknown>
): Promise<WixInvoiceRecord> {
  const response = await invoiceFetch("/invoices/v4/invoices", {
    method: "POST",
    body: JSON.stringify({ invoice }),
  });
  const body = await parseOk<{ invoice?: WixInvoiceRecord }>(response);
  if (!body.invoice?.id) {
    throw new WixInvoiceApiError(response.status, "Wix did not return an invoice.");
  }
  return body.invoice;
}

export async function updateWixInvoice(
  invoiceId: string,
  invoice: Record<string, unknown>
): Promise<WixInvoiceRecord> {
  const response = await invoiceFetch(`/invoices/v4/invoices/${invoiceId}`, {
    method: "PATCH",
    body: JSON.stringify({ invoice }),
  });
  const body = await parseOk<{ invoice?: WixInvoiceRecord }>(response);
  if (!body.invoice?.id) {
    throw new WixInvoiceApiError(response.status, "Wix did not return the updated invoice.");
  }
  return body.invoice;
}

export async function getWixInvoice(invoiceId: string): Promise<WixInvoiceRecord> {
  const response = await invoiceFetch(
    `/invoices/v4/invoices/${encodeURIComponent(invoiceId)}`
  );
  const body = await parseOk<{ invoice?: WixInvoiceRecord }>(response);
  if (!body.invoice?.id) {
    throw new WixInvoiceApiError(response.status, "Wix invoice was not found.");
  }
  return body.invoice;
}

export async function queryWixInvoices(filter: Record<string, unknown>, limit = 50): Promise<{
  invoices: WixInvoiceRecord[];
  pagingMetadata?: { cursors?: { next?: string }; hasNext?: boolean };
}> {
  const response = await invoiceFetch("/invoices/v4/invoices/query", {
    method: "POST",
    body: JSON.stringify({
      query: {
        filter,
        cursorPaging: { limit },
      },
    }),
  });
  const body = await parseOk<{
    invoices?: WixInvoiceRecord[];
    pagingMetadata?: { cursors?: { next?: string }; hasNext?: boolean };
  }>(response);
  return { invoices: body.invoices ?? [], pagingMetadata: body.pagingMetadata };
}

export async function queryWixInvoicesPage(cursor: string, limit = 50): Promise<{
  invoices: WixInvoiceRecord[];
  pagingMetadata?: { cursors?: { next?: string }; hasNext?: boolean };
}> {
  const response = await invoiceFetch("/invoices/v4/invoices/query", {
    method: "POST",
    body: JSON.stringify({
      query: { cursorPaging: { limit, cursor } },
    }),
  });
  const body = await parseOk<{
    invoices?: WixInvoiceRecord[];
    pagingMetadata?: { cursors?: { next?: string }; hasNext?: boolean };
  }>(response);
  return { invoices: body.invoices ?? [], pagingMetadata: body.pagingMetadata };
}

export async function publishWixInvoice(invoiceId: string): Promise<WixInvoiceRecord> {
  const response = await invoiceFetch(`/invoices/v4/invoices/${invoiceId}/publish`, {
    method: "POST",
    body: JSON.stringify({ invoiceId }),
  });
  const body = await parseOk<{ invoice?: WixInvoiceRecord }>(response);
  if (!body.invoice?.id) throw new WixInvoiceApiError(response.status, "Publish did not return an invoice.");
  return body.invoice;
}

/**
 * Wix sends the invoice email. Call this only when publish did not already
 * send. The app must not send a second copy.
 */
export async function sendWixInvoice(invoiceId: string): Promise<WixInvoiceRecord> {
  const response = await invoiceFetch(`/invoices/v4/invoices/${invoiceId}/send`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  const body = await parseOk<{ invoice?: WixInvoiceRecord }>(response);
  if (!body.invoice?.id) throw new WixInvoiceApiError(response.status, "Send did not return an invoice.");
  return body.invoice;
}

export async function voidWixInvoice(invoiceId: string): Promise<WixInvoiceRecord> {
  const response = await invoiceFetch(`/invoices/v4/invoices/${invoiceId}/void`, {
    method: "POST",
    body: JSON.stringify({ invoiceId }),
  });
  const body = await parseOk<{ invoice?: WixInvoiceRecord }>(response);
  if (!body.invoice?.id) throw new WixInvoiceApiError(response.status, "Void did not return an invoice.");
  return body.invoice;
}

export async function deleteWixInvoice(invoiceId: string): Promise<void> {
  const response = await invoiceFetch(`/invoices/v4/invoices/${invoiceId}`, {
    method: "DELETE",
  });
  await parseOk(response);
}

export async function initiateWixInvoicePayment(invoiceId: string): Promise<string | null> {
  const response = await invoiceFetch(`/invoices/v4/invoices/${invoiceId}/initiate-payment`, {
    method: "POST",
    body: JSON.stringify({ invoiceId }),
  });
  const body = await parseOk<{ url?: string }>(response);
  return body.url?.trim() || null;
}

export type WixSiteProperties = {
  businessName: string | null;
  currency: string | null;
  country: string | null;
  subdivision: string | null;
  taxRate: string | null;
};

export async function getWixSiteProperties(): Promise<WixSiteProperties> {
  const response = await invoiceFetch("/site-properties/v4/properties");
  const body = await parseOk<{
    properties?: {
      businessName?: string;
      paymentCurrency?: string;
      address?: { country?: string; subdivision?: string; state?: string };
      taxInfo?: { rate?: string };
    };
  }>(response);
  const properties = body.properties ?? {};
  return {
    businessName: properties.businessName ?? null,
    currency: properties.paymentCurrency ?? null,
    country: properties.address?.country ?? null,
    subdivision: properties.address?.subdivision ?? properties.address?.state ?? null,
    taxRate: properties.taxInfo?.rate ?? null,
  };
}
