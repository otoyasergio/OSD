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
  it("does not touch the database when there is nothing to reserve", async () => {
    const rpc = vi.fn();
    const reserved = await reserveCustomerCredit(
      { rpc } as never,
      "customer-1",
      "inv-1",
      0
    );
    expect(reserved).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns the cents the database actually reserved", async () => {
    const rpc = vi.fn(async () => ({ data: 1500, error: null }));
    const reserved = await reserveCustomerCredit(
      { rpc } as never,
      "customer-1",
      "inv-1",
      4000
    );
    expect(reserved).toBe(1500);
    expect(rpc).toHaveBeenCalledWith("reserve_customer_credit", {
      p_customer_id: "customer-1",
      p_wix_invoice_id: "inv-1",
      p_target_cents: 4000,
    });
  });

  it("surfaces a rejected reservation instead of reporting success", async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { message: "credit write failed" },
    }));
    await expect(
      reserveCustomerCredit({ rpc } as never, "customer-1", "inv-1", 500)
    ).rejects.toEqual({ message: "credit write failed" });
  });
});
