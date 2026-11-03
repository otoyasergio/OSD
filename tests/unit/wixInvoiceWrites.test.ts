import { beforeEach, describe, expect, it, vi } from "vitest";

const { createAdminClient } = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/database/supabase-admin", () => ({ createAdminClient }));
vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/wix/invoiceClient", () => {
  class WixInvoiceApiError extends Error {
    status: number;
    constructor(status: number, detail: string) {
      super(detail);
      this.status = status;
    }
  }
  return {
    WixInvoiceApiError,
    getWixInvoice: vi.fn(),
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

import {
  attachInvoiceToWorkOrder,
  reserveCustomerCredit,
} from "@/lib/services/wixInvoices";

describe("attachInvoiceToWorkOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("surfaces a failed invoice link instead of reporting success", async () => {
    createAdminClient.mockReturnValue({
      from: () => ({
        update: () => ({
          eq: async () => ({ error: { message: "link failed" } }),
        }),
      }),
    });

    await expect(attachInvoiceToWorkOrder("inv-1", "wo-1")).rejects.toThrow(
      /link failed/
    );
  });
});

describe("reserveCustomerCredit", () => {
  const updates: Array<{ table: string; payload: Record<string, unknown> }> = [];

  beforeEach(() => {
    updates.length = 0;
  });

  function admin(creditError: { message: string } | null) {
    return {
      from(table: string) {
        const builder = {
          select() {
            return builder;
          },
          eq() {
            return builder;
          },
          gt() {
            return builder;
          },
          order() {
            return Promise.resolve({
              data:
                table === "customer_credit"
                  ? [{ credit_id: "credit-1", remaining_amount: 10 }]
                  : null,
              error: null,
            });
          },
          maybeSingle: async () => ({
            data: table === "wix_invoice" ? { credit_applied_cents: 0 } : null,
            error: null,
          }),
          update(payload: Record<string, unknown>) {
            updates.push({ table, payload });
            return {
              eq: async () => ({
                error: table === "customer_credit" ? creditError : null,
              }),
            };
          },
        };
        return builder;
      },
    };
  }

  it("does not record reserved credit when the balance write fails", async () => {
    await expect(
      reserveCustomerCredit(
        admin({ message: "credit write failed" }) as never,
        "customer-1",
        "inv-1",
        500
      )
    ).rejects.toThrow(/credit write failed/);

    expect(updates.map((update) => update.table)).toEqual(["customer_credit"]);
  });
});
