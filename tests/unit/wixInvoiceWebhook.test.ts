import { beforeEach, describe, expect, it, vi } from "vitest";

const { wixInvoicesEnabled, getWixInvoice, createAdminClient } = vi.hoisted(() => ({
  wixInvoicesEnabled: vi.fn(() => false),
  getWixInvoice: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/config/features", async () => {
  const actual = await vi.importActual<typeof import("@/lib/config/features")>(
    "@/lib/config/features"
  );
  return { ...actual, wixInvoicesEnabled };
});
vi.mock("@/lib/database/supabase-admin", () => ({ createAdminClient }));
vi.mock("@/lib/wix/invoiceClient", () => {
  class WixInvoiceApiError extends Error {
    status: number;
    constructor(status: number, detail: string) {
      super(detail);
      this.status = status;
      this.name = "WixInvoiceApiError";
    }
  }
  return {
    WixInvoiceApiError,
    getWixInvoice,
    createWixInvoice: vi.fn(),
    getLatestInvoiceNumber: vi.fn(),
    initiateWixInvoicePayment: vi.fn(),
    publishWixInvoice: vi.fn(),
    queryWixInvoices: vi.fn(),
    sendWixInvoice: vi.fn(),
    updateWixInvoice: vi.fn(),
    voidWixInvoice: vi.fn(),
  };
});

import { WixInvoiceApiError } from "@/lib/wix/invoiceClient";
import { handleInvoiceWebhook } from "@/lib/services/wixInvoices";

const INVOICE_ID = "11111111-1111-4111-8111-111111111111";

const canonical = {
  id: INVOICE_ID,
  revision: "4",
  status: "DRAFT",
  numbering: { number: 3894, displayNumber: "0003894" },
  currency: "CAD",
  totals: { total: "10.00", paidAmount: "0.00" },
  dynamicInvoiceUrl: "https://manage.wix.com/invoice/0003894",
  lineItems: [],
  payments: [],
};

const forged = {
  event: "invoice.updated",
  invoice: {
    id: INVOICE_ID,
    revision: "99",
    status: "PAID",
    numbering: { number: 1, displayNumber: "0000001" },
    currency: "CAD",
    totals: { total: "500.00", paidAmount: "500.00" },
    dynamicInvoiceUrl: "https://evil.example/pay",
    lineItems: [{ customItem: { name: "Oil change", price: "1.00" } }],
    payments: [
      {
        id: "paypal-forged",
        amount: "500.00",
        regularPayment: { paymentMethod: "PayPal", paymentStatus: "APPROVED" },
      },
    ],
  },
};

function makeAdmin() {
  const writes: Array<{ table: string; op: string; payload?: unknown }> = [];
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    chain.select = self;
    chain.eq = self;
    chain.order = self;
    chain.limit = self;
    chain.maybeSingle = async () => ({ data: null, error: null });
    chain.single = async () => ({ data: null, error: null });
    chain.insert = (payload: unknown) => {
      writes.push({ table, op: "insert", payload });
      return chain;
    };
    chain.upsert = (payload: unknown) => {
      writes.push({ table, op: "upsert", payload });
      return chain;
    };
    chain.update = (payload: unknown) => {
      writes.push({ table, op: "update", payload });
      return chain;
    };
    chain.delete = () => {
      writes.push({ table, op: "delete" });
      return chain;
    };
    chain.then = (resolve: (value: { data: null; error: null }) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(resolve);
    return chain;
  });
  createAdminClient.mockReturnValue({ from });
  return writes;
}

describe("invoice webhook", () => {
  beforeEach(() => {
    wixInvoicesEnabled.mockReset();
    wixInvoicesEnabled.mockReturnValue(false);
    getWixInvoice.mockReset();
    createAdminClient.mockReset();
  });

  it("records nothing while the switches are off", async () => {
    const writes = makeAdmin();
    const result = await handleInvoiceWebhook(forged);
    expect(result).toEqual({ ignored: true });
    expect(getWixInvoice).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it("stores the invoice Wix returns and drops the caller body", async () => {
    wixInvoicesEnabled.mockReturnValue(true);
    getWixInvoice.mockResolvedValue(canonical);
    const writes = makeAdmin();
    const result = await handleInvoiceWebhook(forged);
    expect(result).toEqual({ ignored: false });
    expect(getWixInvoice).toHaveBeenCalledWith(INVOICE_ID);
    const stored = writes.find((write) => write.table === "wix_invoice" && write.op === "upsert");
    expect(stored?.payload).toMatchObject({
      display_number: "0003894",
      status: "DRAFT",
      total_cents: 1000,
      pay_url: "https://manage.wix.com/invoice/0003894",
    });
    expect(writes.some((write) => write.table === "wix_invoice_payment")).toBe(false);
    expect(writes.some((write) => write.table === "job")).toBe(false);
  });

  it("rejects an id that is not a Wix invoice id", async () => {
    wixInvoicesEnabled.mockReturnValue(true);
    await expect(
      handleInvoiceWebhook({ event: "invoice.updated", invoiceId: "../invoices/1" })
    ).rejects.toThrow("WIX_WEBHOOK_INVOICE_REQUIRED");
    expect(getWixInvoice).not.toHaveBeenCalled();
  });

  it("keeps the local invoice when Wix still has it", async () => {
    wixInvoicesEnabled.mockReturnValue(true);
    getWixInvoice.mockResolvedValue(canonical);
    const writes = makeAdmin();
    const result = await handleInvoiceWebhook({
      event: "invoice.deleted",
      invoiceId: INVOICE_ID,
    });
    expect(result).toEqual({ ignored: true });
    expect(writes.some((write) => write.op === "delete")).toBe(false);
  });

  it("removes the local invoice after Wix says it is gone", async () => {
    wixInvoicesEnabled.mockReturnValue(true);
    getWixInvoice.mockRejectedValue(new WixInvoiceApiError(404, "missing"));
    const writes = makeAdmin();
    const result = await handleInvoiceWebhook({
      event: "invoice.deleted",
      invoiceId: INVOICE_ID,
    });
    expect(result).toEqual({ ignored: false });
    expect(writes).toEqual([{ table: "wix_invoice", op: "delete" }]);
  });
});
