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

export async function upsertSquareCustomer(input: {
  givenName: string;
  familyName: string;
  email?: string | null;
  phone?: string | null;
  referenceId?: string;
  existingId?: string | null;
}): Promise<SquareCustomer> {
  if (!isSquareConfigured()) throw new Error("SQUARE_NOT_CONFIGURED");

  if (input.existingId) {
    const updated = await squareFetch<{ customer: SquareCustomer }>(
      `/v2/customers/${input.existingId}`,
      {
        method: "PUT",
        body: JSON.stringify({
          given_name: input.givenName,
          family_name: input.familyName,
          email_address: input.email ?? undefined,
          phone_number: input.phone ?? undefined,
          reference_id: input.referenceId,
        }),
      }
    );
    return updated.customer;
  }

  const created = await squareFetch<{ customer: SquareCustomer }>(
    "/v2/customers",
    {
      method: "POST",
      body: JSON.stringify({
        given_name: input.givenName,
        family_name: input.familyName,
        email_address: input.email ?? undefined,
        phone_number: input.phone ?? undefined,
        reference_id: input.referenceId,
      }),
    }
  );
  return created.customer;
}

export type SquareInvoiceLine = {
  name: string;
  quantity: string;
  basePriceMoney: { amount: bigint; currency: string };
};

export async function createSquareInvoice(input: {
  customerId: string;
  title: string;
  description?: string;
  lineItems: SquareInvoiceLine[];
  dueDate?: string;
}): Promise<SquareInvoice> {
  const config = getSquareConfig();

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

  const orderId = orderResponse.order.id;

  const invoiceResponse = await squareFetch<{ invoice: SquareInvoice }>(
    "/v2/invoices",
    {
      method: "POST",
      body: JSON.stringify({
        idempotency_key: crypto.randomUUID(),
        invoice: {
          location_id: config.locationId,
          order_id: orderId,
          primary_recipient: { customer_id: input.customerId },
          payment_requests: [
            {
              request_type: "BALANCE",
              due_date: input.dueDate,
              tipping_enabled: false,
            },
          ],
          delivery_method: "SHARE_MANUALLY",
          title: input.title,
          description: input.description,
        },
      }),
    }
  );

  const published = await squareFetch<{ invoice: SquareInvoice }>(
    `/v2/invoices/${invoiceResponse.invoice.id}/publish`,
    {
      method: "POST",
      body: JSON.stringify({
        idempotency_key: crypto.randomUUID(),
        version: 0,
      }),
    }
  );

  return published.invoice;
}

export async function getSquareInvoice(invoiceId: string): Promise<SquareInvoice> {
  const response = await squareFetch<{ invoice: SquareInvoice }>(
    `/v2/invoices/${invoiceId}`
  );
  return response.invoice;
}

export { isSquareConfigured };
