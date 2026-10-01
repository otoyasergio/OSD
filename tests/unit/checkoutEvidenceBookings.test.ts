import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  checkoutEvidenceEnabled,
  createAdminClient,
  getWixBooking,
  addAuditLog,
  addTimelineEvent,
} = vi.hoisted(() => ({
  checkoutEvidenceEnabled: vi.fn(() => false),
  createAdminClient: vi.fn(),
  getWixBooking: vi.fn(),
  addAuditLog: vi.fn(),
  addTimelineEvent: vi.fn(),
}));

vi.mock("@/lib/config/features", async () => {
  const actual = await vi.importActual<typeof import("@/lib/config/features")>(
    "@/lib/config/features"
  );
  return { ...actual, checkoutEvidenceEnabled };
});
vi.mock("@/lib/database/supabase-admin", () => ({ createAdminClient }));
vi.mock("@/lib/wix/config", () => ({ getWixBooking }));
vi.mock("@/lib/audit/addAuditLog", () => ({ addAuditLog }));
vi.mock("@/lib/timeline/addTimelineEvent", () => ({ addTimelineEvent }));

import { processWixBookingWebhook } from "@/lib/services/bookings";

const LOCATION = "31111111-1111-4111-8111-111111111111";
const CUSTOMER = "61111111-1111-4111-8111-111111111111";
const MOTORCYCLE = "21111111-1111-4111-8111-111111111111";
const WO = "41111111-1111-4111-8111-111111111111";

function makeAdmin() {
  const inserts: Array<{ table: string; payload: unknown }> = [];
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.ilike = () => chain;
    chain.order = () => chain;
    chain.maybeSingle = async () => {
      if (table === "work_order") return { data: null, error: null };
      if (table === "customer") return { data: { customer_id: CUSTOMER }, error: null };
      return { data: null, error: null };
    };
    chain.single = async () => {
      if (table === "work_order") {
        return {
          data: { work_order_id: WO, work_order_number: "WO-WIX" },
          error: null,
        };
      }
      if (table === "inspection") {
        return { data: { inspection_id: "insp-1" }, error: null };
      }
      if (table === "customer") {
        return { data: { customer_id: CUSTOMER }, error: null };
      }
      return { data: null, error: null };
    };
    chain.insert = (payload: unknown) => {
      inserts.push({ table, payload });
      return chain;
    };
    chain.then = (onFulfilled: (value: { data: unknown; error: null }) => unknown) => {
      if (table === "motorcycle") {
        return Promise.resolve({
          data: [{ motorcycle_id: MOTORCYCLE, year: 2022, make: "Yamaha", model: "R3" }],
          error: null,
        }).then(onFulfilled);
      }
      if (table === "inspection_template_item") {
        return Promise.resolve({ data: [], error: null }).then(onFulfilled);
      }
      return Promise.resolve({ data: null, error: null }).then(onFulfilled);
    };
    return chain;
  });
  return {
    from,
    inserts,
    rpc: vi.fn(async () => ({ data: "WO-WIX", error: null })),
  };
}

describe("Wix booking work orders checkout flag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    addAuditLog.mockResolvedValue(undefined);
    addTimelineEvent.mockResolvedValue(undefined);
    getWixBooking.mockResolvedValue({
      bookingId: "bk-1",
      contact: { email: "ada@example.com" },
      serviceName: "Oil change",
      startDate: "2026-10-02T14:00:00.000Z",
    });
  });

  it("writes checkout_evidence_required from checkoutEvidenceEnabled() when the flag is off", async () => {
    checkoutEvidenceEnabled.mockReturnValue(false);
    const admin = makeAdmin();
    createAdminClient.mockReturnValue(admin);
    await processWixBookingWebhook({ bookingId: "bk-1", locationId: LOCATION });
    const insert = admin.inserts.find((row) => row.table === "work_order");
    expect(insert?.payload).toEqual(
      expect.objectContaining({ checkout_evidence_required: false })
    );
  });

  it("writes checkout_evidence_required from checkoutEvidenceEnabled() when the flag is on", async () => {
    checkoutEvidenceEnabled.mockReturnValue(true);
    const admin = makeAdmin();
    createAdminClient.mockReturnValue(admin);
    await processWixBookingWebhook({ bookingId: "bk-2", locationId: LOCATION });
    const insert = admin.inserts.find((row) => row.table === "work_order");
    expect(insert?.payload).toEqual(
      expect.objectContaining({ checkout_evidence_required: true })
    );
  });
});
