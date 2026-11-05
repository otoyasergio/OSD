import { beforeEach, describe, expect, it, vi } from "vitest";

const { createAdminClient, requireUser, wixInvoicesEnabled } = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  requireUser: vi.fn(),
  wixInvoicesEnabled: vi.fn(() => true),
}));

vi.mock("@/lib/database/supabase-admin", () => ({ createAdminClient }));
vi.mock("@/lib/auth/session", () => ({ requireUser }));
vi.mock("@/lib/config/features", async () => {
  const actual = await vi.importActual<typeof import("@/lib/config/features")>(
    "@/lib/config/features"
  );
  return { ...actual, wixInvoicesEnabled };
});
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
  createWixInvoice,
  getWixInvoice,
  updateWixInvoice,
} from "@/lib/wix/invoiceClient";
import {
  attachInvoiceToWorkOrder,
  deleteInvoiceLocally,
  prepareIntakeInvoice,
  pushWorkOrderLinesToWix,
  reserveCustomerCredit,
  syncReservedCreditOnInvoice,
  WixIntakeBlockedError,
} from "@/lib/services/wixInvoices";

const INVOICE_ID = "11111111-1111-4111-8111-111111111111";

type Call = {
  table: string;
  op: "select" | "insert" | "update" | "upsert" | "delete";
  payload?: unknown;
  filters: Record<string, unknown>;
};
type Result = { data?: unknown; error?: unknown };

/**
 * A Supabase client double. `answer` decides what each query returns from the
 * table, the operation, and the `eq` filters; anything it skips returns no rows.
 */
function makeAdmin(
  answer: (call: Call) => Result | undefined,
  rpc: (name: string, args: Record<string, unknown>) => Promise<Result>
) {
  const calls: Call[] = [];
  const events: string[] = [];
  const from = (table: string) => {
    const call: Call = { table, op: "select", filters: {} };
    const settle = async () => {
      calls.push(call);
      return { data: null, error: null, ...(answer(call) ?? {}) };
    };
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    for (const name of ["select", "is", "in", "gt", "gte", "not", "order", "limit"]) {
      chain[name] = self;
    }
    chain.eq = (column: string, value: unknown) => {
      call.filters[column] = value;
      return chain;
    };
    for (const op of ["insert", "update", "upsert", "delete"] as const) {
      chain[op] = (payload?: unknown) => {
        call.op = op;
        call.payload = payload;
        return chain;
      };
    }
    chain.maybeSingle = settle;
    chain.single = settle;
    chain.then = (
      resolve: (value: Result) => unknown,
      reject: (reason: unknown) => unknown
    ) => settle().then(resolve, reject);
    return chain;
  };
  const admin = {
    from,
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      events.push(`rpc:${name}`);
      return rpc(name, args);
    }),
  };
  createAdminClient.mockReturnValue(admin);
  return { admin, calls, events };
}

/** The customer has `balanceCents` unspent and the invoice already holds `heldCents`. */
function creditAnswers(balanceCents: number, heldCents: number) {
  return (call: Call): Result | undefined => {
    if (call.table === "customer_credit" && call.op === "select") {
      return {
        data: balanceCents > 0 ? [{ remaining_amount: balanceCents / 100 }] : [],
      };
    }
    if (
      call.table === "wix_invoice" &&
      call.op === "select" &&
      call.filters.wix_invoice_id === INVOICE_ID
    ) {
      return { data: { credit_applied_cents: heldCents, customer_id: "customer-1" } };
    }
    return undefined;
  };
}

const header = [{ title: "VIN", value: "JH2SC5901KK000001" }];
const wixDraft = {
  id: INVOICE_ID,
  revision: "2",
  status: "DRAFT",
  numbering: { number: 3894, displayNumber: "0003894" },
  lineItems: [],
  payments: [],
};

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

  it("asks for everything back with a target of zero", async () => {
    const rpc = vi.fn(async () => ({ data: 0, error: null }));
    const reserved = await reserveCustomerCredit(
      { rpc } as never,
      "customer-1",
      "inv-1",
      0
    );
    expect(reserved).toBe(0);
    expect(rpc).toHaveBeenCalledWith(
      "reserve_customer_credit",
      expect.objectContaining({ p_target_cents: 0 })
    );
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

describe("syncReservedCreditOnInvoice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const input = {
    customerId: "customer-1",
    wixInvoiceId: INVOICE_ID,
    revision: "2",
    status: "DRAFT",
    lines: [{ name: "Oil change", price: 100 }],
    title: "2018 HONDA CB500F",
    header,
    technicianName: null,
  };

  it("leaves the balance alone when Wix will not take an edit", async () => {
    for (const status of ["PUBLISHING", "PAID", "VOIDED"]) {
      const { admin } = makeAdmin(creditAnswers(5000, 0), async () => ({ data: 5000 }));
      await syncReservedCreditOnInvoice(admin as never, { ...input, status });
      expect(admin.rpc).not.toHaveBeenCalled();
      expect(updateWixInvoice).not.toHaveBeenCalled();
    }
  });

  it("discounts the invoice by what was reserved, not by what was asked for", async () => {
    const { admin } = makeAdmin(creditAnswers(5000, 0), async () => ({ data: 1500 }));
    vi.mocked(updateWixInvoice).mockResolvedValue({ ...wixDraft, revision: "3" });

    await syncReservedCreditOnInvoice(admin as never, input);

    expect(admin.rpc).toHaveBeenCalledWith(
      "reserve_customer_credit",
      expect.objectContaining({ p_target_cents: 5000 })
    );
    expect(updateWixInvoice).toHaveBeenCalledWith(
      INVOICE_ID,
      expect.objectContaining({
        discounts: [expect.objectContaining({ fixedDiscount: "15.00" })],
      })
    );
  });

  it("never reserves more than the lines add up to before tax", async () => {
    const { admin } = makeAdmin(creditAnswers(50000, 0), async () => ({ data: 10000 }));
    vi.mocked(updateWixInvoice).mockResolvedValue({ ...wixDraft, revision: "3" });

    await syncReservedCreditOnInvoice(admin as never, input);

    expect(admin.rpc).toHaveBeenCalledWith(
      "reserve_customer_credit",
      expect.objectContaining({ p_target_cents: 10000 })
    );
  });

  it("does not call the database for a customer with no credit", async () => {
    const { admin } = makeAdmin(creditAnswers(0, 0), async () => ({ data: 0 }));
    await syncReservedCreditOnInvoice(admin as never, input);
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(updateWixInvoice).not.toHaveBeenCalled();
  });
});

describe("pushWorkOrderLinesToWix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wixInvoicesEnabled.mockReturnValue(true);
  });

  /** One open draft on work order `wo-1`, holding 100.00 of credit, with these jobs. */
  function openDraftHolding100(jobs: Array<Record<string, unknown>>, rpcResult: number) {
    const credit = creditAnswers(0, 10000);
    const made = makeAdmin(
      (call) => {
        if (call.table === "wix_invoice" && call.filters.work_order_id === "wo-1") {
          return {
            data: [
              {
                wix_invoice_id: INVOICE_ID,
                revision: "2",
                status: "DRAFT",
                voided: false,
                display_number: "0003894",
              },
            ],
          };
        }
        if (call.table === "work_order" && call.filters.work_order_id === "wo-1") {
          return {
            data: {
              work_order_id: "wo-1",
              customer_id: "customer-1",
              motorcycle_id: "bike-1",
              mileage: 1200,
              mileage_unit: "km",
              primary_technician_id: null,
            },
          };
        }
        if (call.table === "job" && call.op === "select") return { data: jobs };
        if (call.table === "motorcycle") {
          return {
            data: {
              year: 2018,
              make: "HONDA",
              model: "CB500F",
              colour: "Red",
              plate_number: "ABC123",
              vin: "JH2SC5901KK000001",
            },
          };
        }
        return credit(call);
      },
      async () => ({ data: rpcResult })
    );
    vi.mocked(getWixInvoice).mockResolvedValue(wixDraft);
    vi.mocked(updateWixInvoice).mockImplementation(async () => {
      made.events.push("wix:update");
      return { ...wixDraft, revision: "3" };
    });
    return made;
  }

  it("gives credit back when the lines shrink below what the invoice holds", async () => {
    const { admin, events } = openDraftHolding100(
      [
        {
          job_id: "job-1",
          service_name_snapshot: "Oil change",
          standard_price_snapshot: 60,
          status: "open",
        },
      ],
      6000
    );

    await pushWorkOrderLinesToWix("wo-1");

    expect(admin.rpc).toHaveBeenCalledWith(
      "reserve_customer_credit",
      expect.objectContaining({ p_target_cents: 6000 })
    );
    expect(updateWixInvoice).toHaveBeenCalledWith(
      INVOICE_ID,
      expect.objectContaining({
        discounts: [expect.objectContaining({ fixedDiscount: "60.00" })],
      })
    );
    expect(events).toEqual(["rpc:reserve_customer_credit", "wix:update"]);
  });

  it("takes the discount off Wix when the invoice no longer holds any credit", async () => {
    const { admin } = openDraftHolding100(
      [
        {
          job_id: "job-1",
          service_name_snapshot: "Oil change",
          standard_price_snapshot: 60,
          status: "declined",
        },
      ],
      0
    );

    await pushWorkOrderLinesToWix("wo-1");

    expect(admin.rpc).toHaveBeenCalledWith(
      "reserve_customer_credit",
      expect.objectContaining({ p_target_cents: 0 })
    );
    expect(updateWixInvoice).toHaveBeenCalledWith(
      INVOICE_ID,
      expect.objectContaining({ discounts: [] })
    );
  });
});

describe("prepareIntakeInvoice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("WIX_API_KEY", "test-key");
    vi.stubEnv("WIX_SITE_ID", "test-site");
    requireUser.mockResolvedValue({ user_id: "staff-1", role: "owner" });
  });

  it("holds the intake on the same invoice when the credit discount cannot be written", async () => {
    const credit = creditAnswers(5000, 0);
    const { calls, events } = makeAdmin(
      (call) => {
        if (call.table === "customer" && call.filters.customer_id === "customer-1") {
          return {
            data: {
              customer_id: "customer-1",
              first_name: "Evan",
              last_name: "Kerr",
              phone: "647-555-0142",
              email: null,
              address: null,
              wix_contact_id: "contact-1",
            },
          };
        }
        if (call.table === "motorcycle") {
          return {
            data: {
              motorcycle_id: "bike-1",
              year: 2018,
              make: "HONDA",
              model: "CB500F",
              colour: "Red",
              plate_number: "ABC123",
              vin: "JH2SC5901KK000001",
            },
          };
        }
        if (call.table === "invoice_create_acknowledgement" && call.op === "insert") {
          return { data: { acknowledgement_id: "ack-1", hold_revision: 1 } };
        }
        return credit(call);
      },
      async () => ({ data: 5000 })
    );
    vi.mocked(createWixInvoice).mockResolvedValue(wixDraft);
    vi.mocked(updateWixInvoice).mockImplementation(async () => {
      events.push("wix:update");
      throw new Error("Wix timed out.");
    });

    const attempt = prepareIntakeInvoice({
      customerId: "customer-1",
      motorcycleId: "bike-1",
      mileage: 1200,
      mileageUnit: "km",
      serviceLines: [{ name: "Oil change", price: 100 }],
      technicianName: null,
    });

    await expect(attempt).rejects.toBeInstanceOf(WixIntakeBlockedError);
    await expect(attempt).rejects.toThrow(/Wix created invoice 0003894/);
    expect(vi.mocked(createWixInvoice).mock.calls[0][0]).not.toHaveProperty("discounts");
    expect(events).toEqual(["rpc:reserve_customer_credit", "wix:update"]);
    const hold = calls.find(
      (call) => call.table === "invoice_create_acknowledgement" && call.op === "insert"
    );
    expect(hold?.payload).toMatchObject({
      wix_invoice_id: INVOICE_ID,
      customer_id: "customer-1",
    });
  });
});

describe("deleteInvoiceLocally", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the credit a deleted invoice was holding before removing the row", async () => {
    const { admin, calls } = makeAdmin(creditAnswers(0, 4000), async () => ({ data: 0 }));

    await deleteInvoiceLocally(INVOICE_ID);

    expect(admin.rpc).toHaveBeenCalledWith("reserve_customer_credit", {
      p_customer_id: "customer-1",
      p_wix_invoice_id: INVOICE_ID,
      p_target_cents: 0,
    });
    expect(calls.at(-1)).toMatchObject({ table: "wix_invoice", op: "delete" });
  });

  it("keeps the row when the credit cannot be returned", async () => {
    const { calls } = makeAdmin(creditAnswers(0, 4000), async () => ({
      error: { message: "credit write failed" },
    }));

    await expect(deleteInvoiceLocally(INVOICE_ID)).rejects.toEqual({
      message: "credit write failed",
    });
    expect(calls.some((call) => call.op === "delete")).toBe(false);
  });
});
