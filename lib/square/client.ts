import {
  getSquareConfig,
  isSquareConfigured,
  squareApiBase,
} from "@/lib/square/config";

type SquareCustomer = { id: string };
type SquareInvoice = {
  id: string;
  invoice_number?: string;
  public_url?: string;
  status?: string;
};

/** Prefer Square's human-readable invoice_number; fall back to id. */
export function squareInvoiceDisplayNumber(invoice: {
  invoice_number?: string | null;
  id?: string | null;
}): string | null {
  const number = invoice.invoice_number?.trim();
  if (number) return number;
  const id = invoice.id?.trim();
  return id || null;
}

async function squareFetch<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const config = getSquareConfig();
  const base = squareApiBase(config.environment);
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      "Content-Type": "application/json",
      "Square-Version": "2024-12-18",
      ...(init?.headers ?? {}),
    },
  });

  const body = (await response.json()) as T & {
    errors?: { detail?: string; code?: string }[];
  };

  if (!response.ok) {
    const detail =
      body.errors?.[0]?.detail ?? body.errors?.[0]?.code ?? response.statusText;
    throw new Error(`SQUARE_API_ERROR: ${detail}`);
  }

  return body;
}

/** Square expects E.164; omit junk / incomplete shop numbers rather than failing the invoice. */
function toSquarePhone(phone?: string | null): string | undefined {
  if (!phone?.trim()) return undefined;
  const digits = phone.replace(/\D/g, "");
  // Reject obvious placeholders (all same digit / sequential test junk)
  if (/^(\d)\1{9,}$/.test(digits)) return undefined;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (phone.trim().startsWith("+") && digits.length >= 10) return `+${digits}`;
  return undefined;
}

function customerBody(input: {
  givenName: string;
  familyName: string;
  email?: string | null;
  phone?: string | null;
  referenceId?: string;
}) {
  return {
    given_name: input.givenName,
    family_name: input.familyName,
    email_address: input.email?.trim() || undefined,
    phone_number: toSquarePhone(input.phone),
    reference_id: input.referenceId,
  };
}

export async function upsertSquareCustomer(input: {
  givenName: string;
  familyName: string;
  email?: string | null;
  phone?: string | null;
  referenceId?: string;
  existingId?: string | null;
}): Promise<SquareCustomer> {
  if (!isSquareConfigured()) throw new Error("SQUARE_NOT_CONFIGURED");

  const body = customerBody(input);

  async function request(path: string, method: "POST" | "PUT", payload: typeof body) {
    return squareFetch<{ customer: SquareCustomer }>(path, {
      method,
      body: JSON.stringify(payload),
    });
  }

  try {
    if (input.existingId) {
      const updated = await request(`/v2/customers/${input.existingId}`, "PUT", body);
      return updated.customer;
    }
    const created = await request("/v2/customers", "POST", body);
    return created.customer;
  } catch (error) {
    // Retry without phone/email if Square rejects contact fields
    if (!body.phone_number && !body.email_address) throw error;
    const stripped = { ...body, phone_number: undefined, email_address: undefined };
    if (input.existingId) {
      const updated = await request(`/v2/customers/${input.existingId}`, "PUT", stripped);
      return updated.customer;
    }
    const created = await request("/v2/customers", "POST", stripped);
    return created.customer;
  }
}

export type SquareInvoiceLine = {
  name: string;
  quantity: string;
  basePriceMoney: { amount: bigint; currency: string };
};

type SquareInvoiceWithVersion = SquareInvoice & { version?: number };

export async function createSquareInvoiceDraft(input: {
  customerId: string;
  title: string;
  description?: string;
  lineItems: SquareInvoiceLine[];
  dueDate?: string;
}): Promise<SquareInvoiceWithVersion> {
  const config = getSquareConfig();

  const dueDate =
    input.dueDate ??
    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const orderResponse = await squareFetch<{ order: { id: string } }>(
    "/v2/orders",
    {
      method: "POST",
      body: JSON.stringify({
        idempotency_key: crypto.randomUUID(),
        order: {
          location_id: config.locationId,
          customer_id: input.customerId,
          line_items: input.lineItems.map((line) => ({
            name: line.name,
            quantity: line.quantity,
            base_price_money: {
              amount: Number(line.basePriceMoney.amount),
              currency: line.basePriceMoney.currency,
            },
          })),
        },
      }),
    }
  );

  const invoiceResponse = await squareFetch<{ invoice: SquareInvoiceWithVersion }>(
    "/v2/invoices",
    {
      method: "POST",
      body: JSON.stringify({
        idempotency_key: crypto.randomUUID(),
        invoice: {
          location_id: config.locationId,
          order_id: orderResponse.order.id,
          primary_recipient: { customer_id: input.customerId },
          payment_requests: [
            {
              request_type: "BALANCE",
              due_date: dueDate,
              tipping_enabled: false,
              automatic_payment_source: "NONE",
            },
          ],
          delivery_method: "SHARE_MANUALLY",
          accepted_payment_methods: {
            card: true,
            square_gift_card: false,
            bank_account: false,
            buy_now_pay_later: false,
            cash_app_pay: false,
          },
          title: input.title,
          description: input.description,
        },
      }),
    }
  );

  return invoiceResponse.invoice;
}

export async function publishSquareInvoice(
  invoiceId: string,
  version: number
): Promise<SquareInvoiceWithVersion> {
  const published = await squareFetch<{ invoice: SquareInvoiceWithVersion }>(
    `/v2/invoices/${invoiceId}/publish`,
    {
      method: "POST",
      body: JSON.stringify({
        idempotency_key: crypto.randomUUID(),
        version,
      }),
    }
  );
  return published.invoice;
}

export async function cancelSquareInvoice(
  invoiceId: string,
  version: number
): Promise<SquareInvoiceWithVersion> {
  const cancelled = await squareFetch<{ invoice: SquareInvoiceWithVersion }>(
    `/v2/invoices/${invoiceId}/cancel`,
    {
      method: "POST",
      body: JSON.stringify({
        version,
      }),
    }
  );
  return cancelled.invoice;
}

/** Create draft and immediately publish (legacy one-shot). */
export async function createSquareInvoice(input: {
  customerId: string;
  title: string;
  description?: string;
  lineItems: SquareInvoiceLine[];
  dueDate?: string;
}): Promise<SquareInvoice> {
  const draft = await createSquareInvoiceDraft(input);
  return publishSquareInvoice(draft.id, draft.version ?? 0);
}

export async function getSquareInvoice(
  invoiceId: string
): Promise<SquareInvoiceWithVersion> {
  const response = await squareFetch<{ invoice: SquareInvoiceWithVersion }>(
    `/v2/invoices/${invoiceId}`
  );
  return response.invoice;
}

export { isSquareConfigured };
