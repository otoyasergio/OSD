import { beforeEach, describe, expect, it, vi } from "vitest";
import { CHECKOUT_PHOTO_CATEGORIES } from "@/lib/status/checkoutEvidence";
import { checkoutCoverageFromPhotos } from "@/lib/status/checkoutEvidence";

const {
  addAuditLog,
  addTimelineEvent,
  createClient,
  requireUser,
  checkoutEvidenceEnabled,
} = vi.hoisted(() => ({
  addAuditLog: vi.fn(),
  addTimelineEvent: vi.fn(),
  createClient: vi.fn(),
  requireUser: vi.fn(),
  checkoutEvidenceEnabled: vi.fn(() => false),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser }));
vi.mock("@/lib/database/supabase-server", () => ({ createClient }));
vi.mock("@/lib/audit/addAuditLog", () => ({ addAuditLog }));
vi.mock("@/lib/timeline/addTimelineEvent", () => ({ addTimelineEvent }));
vi.mock("@/lib/config/features", async () => {
  const actual = await vi.importActual<typeof import("@/lib/config/features")>(
    "@/lib/config/features"
  );
  return { ...actual, checkoutEvidenceEnabled };
});

import {
  markReadyForPickup,
  completeWorkOrder,
  recordCheckoutEvidenceOverride,
} from "@/lib/services/quality";
import { moveWorkOrderOnBoard } from "@/lib/services/workOrderTransitions";
import { createWorkOrder } from "@/lib/services/workOrders";
import { clearFinishedStampsForNewRecommendationWork } from "@/lib/services/recommendations";
import { loadCommittedCheckoutCoverage } from "@/lib/services/checkoutEvidence";
import { recordCheckoutEvidenceOverrideAction } from "@/app/(app)/work_orders/quality-actions";
import { recalculateWorkOrderStatus } from "@/lib/status/recalculateWorkOrderStatus";

const WO = "41111111-1111-4111-8111-111111111111";
const USER = "11111111-1111-4111-8111-111111111111";
const LOCATION = "31111111-1111-4111-8111-111111111111";
const MOTORCYCLE = "21111111-1111-4111-8111-111111111111";
const SERVICE = "51111111-1111-4111-8111-111111111111";
const CUSTOMER = "61111111-1111-4111-8111-111111111111";

type QueryLog = {
  table: string;
  op: "select" | "update" | "insert";
  payload?: unknown;
  filters: Array<{ method: string; args: unknown[] }>;
};

function thenableSelect(
  table: string,
  log: QueryLog[],
  resolve: (filters: Array<{ method: string; args: unknown[] }>) => {
    data: unknown;
    error: null;
  }
) {
  const filters: Array<{ method: string; args: unknown[] }> = [];
  const entry: QueryLog = { table, op: "select", filters };
  const chain: {
    select: (...args: unknown[]) => unknown;
    eq: (...args: unknown[]) => unknown;
    in: (...args: unknown[]) => unknown;
    order: (...args: unknown[]) => unknown;
    maybeSingle: () => Promise<{ data: unknown; error: null }>;
    single: () => Promise<{ data: unknown; error: null }>;
    then: (
      onFulfilled: (value: { data: unknown; error: null }) => unknown
    ) => Promise<unknown>;
  } = {
    select: (...args: unknown[]) => {
      filters.push({ method: "select", args });
      return chain;
    },
    eq: (...args: unknown[]) => {
      filters.push({ method: "eq", args });
      return chain;
    },
    in: (...args: unknown[]) => {
      filters.push({ method: "in", args });
      return chain;
    },
    order: (...args: unknown[]) => {
      filters.push({ method: "order", args });
      return chain;
    },
    maybeSingle: async () => {
      log.push(entry);
      return resolve(filters);
    },
    single: async () => {
      log.push(entry);
      return resolve(filters);
    },
    then: (onFulfilled) => {
      log.push(entry);
      return Promise.resolve(resolve(filters)).then(onFulfilled);
    },
  };
  return chain;
}

function makeClient(options: {
  workOrder?: Record<string, unknown>;
  jobs?: Array<Record<string, unknown>>;
  inspection?: Record<string, unknown> | null;
  photos?: Array<Record<string, unknown>>;
  motorcycle?: Record<string, unknown> | null;
  services?: Array<Record<string, unknown>>;
  existingWo?: Record<string, unknown> | null;
  templateItems?: Array<Record<string, unknown>>;
}) {
  const log: QueryLog[] = [];
  const updates: Array<{ table: string; payload: Record<string, unknown> }> = [];
  const inserts: Array<{ table: string; payload: unknown }> = [];
  const workOrder = {
    work_order_id: WO,
    location_id: LOCATION,
    status: "quality_check",
    quality_checked_at: "2026-10-01T12:00:00.000Z",
    quality_checked_by_user_id: USER,
    ready_for_pickup_at: null,
    safety_checked_at: "2026-10-01T12:05:00.000Z",
    safety_checked_by_user_id: USER,
    safety_required: false,
    safety_waived: true,
    checkout_evidence_required: true,
    checkout_evidence_override_at: null,
    checkout_evidence_override_by_user_id: null,
    checkout_evidence_override_reason: null,
    work_order_number: "WO-100",
    ...options.workOrder,
  };
  const from = vi.fn((table: string) => {
    return {
      select: (...args: unknown[]) =>
        thenableSelect(table, log, (filters) => {
          if (table === "work_order") {
            if (
              filters.some(
                (filter) =>
                  filter.method === "eq" && filter.args[0] === "work_order_number"
              )
            ) {
              return { data: options.existingWo ?? null, error: null };
            }
            return { data: workOrder, error: null };
          }
          if (table === "job") {
            return {
              data: options.jobs ?? [
                { job_id: "j1", status: "completed", service_name_snapshot: "Oil" },
              ],
              error: null,
            };
          }
          if (table === "inspection") {
            return {
              data:
                options.inspection === undefined
                  ? { completed_at: "2026-10-01T11:00:00.000Z" }
                  : options.inspection,
              error: null,
            };
          }
          if (table === "intake_photo") {
            return { data: options.photos ?? [], error: null };
          }
          if (table === "motorcycle") {
            return {
              data: options.motorcycle ?? {
                motorcycle_id: MOTORCYCLE,
                customer_id: CUSTOMER,
                year: 2022,
                make: "Yamaha",
                model: "R3",
                odometer_unit: "km",
              },
              error: null,
            };
          }
          if (table === "service") {
            return {
              data: options.services ?? [
                {
                  service_id: SERVICE,
                  name: "Oil Change",
                  standard_price: 100,
                  estimated_labour: 1,
                  active: true,
                },
              ],
              error: null,
            };
          }
          if (table === "inspection_template_item") {
            return { data: options.templateItems ?? [], error: null };
          }
          if (table === "drop_off_agreement") {
            return { data: { agreement_id: "a1" }, error: null };
          }
          if (table === "part") {
            return { data: [], error: null };
          }
          return { data: null, error: null };
        }).select(...args),
      update: (payload: Record<string, unknown>) => {
        updates.push({ table, payload });
        log.push({ table, op: "update", payload, filters: [] });
        return {
          eq: async () => ({ error: null }),
        };
      },
      insert: (payload: unknown) => {
        inserts.push({ table, payload });
        log.push({ table, op: "insert", payload, filters: [] });
        const inserted =
          table === "work_order"
            ? {
                work_order_id: WO,
                work_order_number: "WO-100",
                location_id: LOCATION,
                status: "open",
              }
            : table === "inspection"
              ? { inspection_id: "insp-1" }
              : table === "job"
                ? { job_id: "job-1", service_name_snapshot: "Oil Change" }
                : payload;
        const chain = {
          select: () => chain,
          single: async () => ({ data: inserted, error: null }),
          then: (onFulfilled: (value: { data: unknown; error: null }) => unknown) =>
            Promise.resolve({ data: inserted, error: null }).then(onFulfilled),
        };
        return chain;
      },
    };
  });
  return { from, log, updates, inserts };
}

const owner = {
  user_id: USER,
  role: "owner" as const,
  status: "active" as const,
  active_location_id: LOCATION,
  location_ids: [LOCATION],
};

const advisor = {
  ...owner,
  role: "service_advisor" as const,
};

const technician = {
  ...owner,
  role: "technician" as const,
};

describe("committed checkout evidence queries", () => {
  it("loads only the five checkout categories from intake_photo", async () => {
    const client = makeClient({
      photos: [{ category: "checkout_front" }, { category: "front" }],
    });
    const coverage = await loadCommittedCheckoutCoverage(client as never, WO);
    const photoQuery = client.log.find((entry) => entry.table === "intake_photo");
    expect(photoQuery?.filters.some((filter) => filter.method === "in")).toBe(true);
    const inFilter = photoQuery?.filters.find((filter) => filter.method === "in");
    expect(inFilter?.args[1]).toEqual([...CHECKOUT_PHOTO_CATEGORIES]);
    expect(coverage.complete).toBe(false);
    expect(coverage.covered).toEqual(["checkout_front"]);
  });
});

describe("pickup service gates query committed checkout photos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    addAuditLog.mockResolvedValue(undefined);
    addTimelineEvent.mockResolvedValue(undefined);
    requireUser.mockResolvedValue(advisor);
  });

  it("markReadyForPickup rejects missing committed checkout evidence", async () => {
    const client = makeClient({ photos: [{ category: "front" }] });
    createClient.mockResolvedValue(client);
    await expect(markReadyForPickup(WO)).rejects.toThrow("CHECKOUT_EVIDENCE_REQUIRED");
    expect(client.log.some((entry) => entry.table === "intake_photo")).toBe(true);
    expect(client.updates.some((row) => row.payload.status === "ready_for_pickup")).toBe(
      false
    );
  });

  it("completeWorkOrder rejects missing committed checkout evidence", async () => {
    const client = makeClient({
      workOrder: {
        status: "ready_for_pickup",
        ready_for_pickup_at: "2026-10-01T12:10:00.000Z",
      },
      photos: [],
    });
    createClient.mockResolvedValue(client);
    await expect(completeWorkOrder(WO, "keys")).rejects.toThrow(
      "CHECKOUT_EVIDENCE_REQUIRED"
    );
    expect(client.updates.some((row) => row.payload.status === "completed")).toBe(false);
  });

  it("board pickup moves reject missing committed checkout evidence", async () => {
    const client = makeClient({ photos: [] });
    createClient.mockResolvedValue(client);
    await expect(moveWorkOrderOnBoard(WO, "pickup")).rejects.toThrow(
      "CHECKOUT_EVIDENCE_REQUIRED"
    );
  });

  it("markReadyForPickup proceeds when all five committed categories exist", async () => {
    const client = makeClient({
      photos: CHECKOUT_PHOTO_CATEGORIES.map((category) => ({ category })),
    });
    createClient.mockResolvedValue(client);
    await markReadyForPickup(WO);
    expect(client.updates.some((row) => row.payload.status === "ready_for_pickup")).toBe(
      true
    );
  });
});

describe("recordCheckoutEvidenceOverride", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    addAuditLog.mockResolvedValue(undefined);
    addTimelineEvent.mockResolvedValue(undefined);
  });

  it("rejects technicians and blank reasons", async () => {
    requireUser.mockResolvedValue(technician);
    createClient.mockResolvedValue(makeClient({}));
    await expect(recordCheckoutEvidenceOverride(WO, "wet weather")).rejects.toThrow(
      "FORBIDDEN"
    );

    requireUser.mockResolvedValue(owner);
    createClient.mockResolvedValue(makeClient({}));
    await expect(recordCheckoutEvidenceOverride(WO, "   ")).rejects.toThrow(
      "OVERRIDE_REASON_REQUIRED"
    );
  });

  it("persists reason only and writes timeline/audit with missing categories", async () => {
    requireUser.mockResolvedValue(owner);
    const client = makeClient({
      photos: [{ category: "checkout_front" }],
      workOrder: {
        checkout_evidence_override_at: "2026-09-01T00:00:00.000Z",
        checkout_evidence_override_by_user_id: "old-user",
        checkout_evidence_override_reason: "old reason",
      },
    });
    createClient.mockResolvedValue(client);
    await recordCheckoutEvidenceOverride(WO, "  Camera failed in the rain  ");
    const update = client.updates.find((row) => row.table === "work_order");
    expect(update?.payload).toEqual(
      expect.objectContaining({
        checkout_evidence_override_reason: "Camera failed in the rain",
      })
    );
    expect(update?.payload).not.toHaveProperty("checkout_evidence_override_at");
    expect(update?.payload).not.toHaveProperty("checkout_evidence_override_by_user_id");
    expect(addTimelineEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        work_order_id: WO,
        description: expect.stringMatching(/checkout|override/i),
        old_value: expect.objectContaining({
          checkout_evidence_override_reason: "old reason",
        }),
        new_value: expect.objectContaining({
          reason: "Camera failed in the rain",
          missing_categories: [
            "checkout_rear",
            "checkout_left_side",
            "checkout_right_side",
            "checkout_odometer",
          ],
        }),
      })
    );
    expect(addAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "checkout_evidence_overridden",
        new_value: expect.objectContaining({
          reason: "Camera failed in the rain",
          actor_user_id: USER,
        }),
      })
    );
  });
});

describe("recordCheckoutEvidenceOverrideAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    addAuditLog.mockResolvedValue(undefined);
    addTimelineEvent.mockResolvedValue(undefined);
  });

  it("maps OVERRIDE_REASON_REQUIRED to staff copy", async () => {
    requireUser.mockResolvedValue(owner);
    createClient.mockResolvedValue(makeClient({}));
    const formData = new FormData();
    formData.set("reason", " ");
    const result = await recordCheckoutEvidenceOverrideAction(
      WO,
      { error: null },
      formData
    );
    expect(result.error).toBe("Enter a reason to override this gate.");
  });
});

describe("createWorkOrder checkout flag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    addAuditLog.mockResolvedValue(undefined);
    addTimelineEvent.mockResolvedValue(undefined);
    requireUser.mockResolvedValue(advisor);
  });

  it("writes checkout_evidence_required from the flag at creation", async () => {
    checkoutEvidenceEnabled.mockReturnValue(false);
    const disabled = makeClient({ existingWo: null });
    createClient.mockResolvedValue(disabled);
    await createWorkOrder({
      motorcycle_id: MOTORCYCLE,
      location_id: LOCATION,
      work_order_number: "WO-100",
      mileage: 1200,
      estimated_completion: "2026-10-02T16:00:00.000Z",
      service_ids: [SERVICE],
    });
    const insert = disabled.inserts.find((row) => row.table === "work_order");
    expect(insert?.payload).toEqual(
      expect.objectContaining({ checkout_evidence_required: false })
    );

    checkoutEvidenceEnabled.mockReturnValue(true);
    const enabled = makeClient({ existingWo: null });
    createClient.mockResolvedValue(enabled);
    await createWorkOrder({
      motorcycle_id: MOTORCYCLE,
      location_id: LOCATION,
      work_order_number: "WO-101",
      mileage: 1200,
      estimated_completion: "2026-10-02T16:00:00.000Z",
      service_ids: [SERVICE],
    });
    expect(enabled.inserts.find((row) => row.table === "work_order")?.payload).toEqual(
      expect.objectContaining({ checkout_evidence_required: true })
    );
  });
});

describe("recalculateWorkOrderStatus checkout auto-ready", () => {
  it("does not write ready_for_pickup when required evidence is still missing", async () => {
    const client = makeClient({
      workOrder: { status: "quality_check" },
      photos: [{ category: "checkout_front" }],
    });
    const next = await recalculateWorkOrderStatus(client as never, WO, USER);
    expect(next).toBe("quality_check");
    expect(client.log.some((entry) => entry.table === "intake_photo")).toBe(true);
    expect(client.updates.some((row) => row.payload.status === "ready_for_pickup")).toBe(
      false
    );
  });

  it("derives ready_for_pickup once committed checkout photos are complete", async () => {
    const client = makeClient({
      workOrder: { status: "quality_check" },
      photos: CHECKOUT_PHOTO_CATEGORIES.map((category) => ({ category })),
    });
    const next = await recalculateWorkOrderStatus(client as never, WO, USER);
    expect(next).toBe("ready_for_pickup");
    expect(client.updates.some((row) => row.payload.status === "ready_for_pickup")).toBe(
      true
    );
  });
});

describe("reopening recommendation work", () => {
  it("clears checkout override stamps and leaves historical checkout photos in place", async () => {
    const client = makeClient({
      workOrder: {
        status: "ready_for_pickup",
        quality_checked_at: "2026-10-01T12:00:00.000Z",
        ready_for_pickup_at: "2026-10-01T12:10:00.000Z",
        checkout_evidence_override_at: "2026-10-01T12:08:00.000Z",
        checkout_evidence_override_by_user_id: USER,
        checkout_evidence_override_reason: "wet",
      },
      photos: CHECKOUT_PHOTO_CATEGORIES.map((category) => ({ category })),
    });
    const cleared = await clearFinishedStampsForNewRecommendationWork(
      client as never,
      WO
    );
    expect(cleared).toBe(true);
    expect(client.updates[0]?.payload).toEqual(
      expect.objectContaining({
        quality_checked_at: null,
        safety_checked_at: null,
        ready_for_pickup_at: null,
        checkout_evidence_override_at: null,
        checkout_evidence_override_by_user_id: null,
        checkout_evidence_override_reason: null,
      })
    );
    expect(
      client.log.some((entry) => entry.table === "intake_photo" && entry.op === "update")
    ).toBe(false);
    expect(
      checkoutCoverageFromPhotos(
        CHECKOUT_PHOTO_CATEGORIES.map((category) => ({ category }))
      ).complete
    ).toBe(true);
  });
});
