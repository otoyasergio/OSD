import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireUser: mocks.requireUser,
}));

vi.mock("@/lib/database/supabase-server", () => ({
  createClient: mocks.createClient,
}));

import {
  listOutstandingRecommendationsForMotorcycle,
  listRecommendationsForWorkOrder,
} from "@/lib/services/recommendations";

type SelectCall = {
  table: string;
  columns: string;
};

function createQuery(table: string, calls: SelectCall[]) {
  const result = { data: [], error: null };
  const query = {
    select(columns: string) {
      calls.push({ table, columns });
      return query;
    },
    eq() {
      return query;
    },
    in() {
      return query;
    },
    not() {
      return query;
    },
    order() {
      return query;
    },
    then<TResult1 = typeof result, TResult2 = never>(
      onfulfilled?: ((value: typeof result) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ) {
      return Promise.resolve(result).then(onfulfilled, onrejected);
    },
  };
  return query;
}

describe("recommendation Workflow V2 schema gate", () => {
  const selectCalls: SelectCall[] = [];

  beforeEach(() => {
    selectCalls.length = 0;
    vi.stubEnv("JOBS_ESTIMATE_V2_KILL_SWITCH", "0");
    vi.stubEnv("JOBS_ESTIMATE_V2_READ_MODE", "legacy");
    vi.stubEnv("JOBS_ESTIMATE_V2_WRITE_MODE", "legacy");
    mocks.requireUser.mockResolvedValue({ user_id: "user-1" });
    mocks.createClient.mockResolvedValue({
      from: (table: string) => createQuery(table, selectCalls),
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("lists a work order without selecting pending V2 columns in legacy mode", async () => {
    await listRecommendationsForWorkOrder("work-order-1");

    const recommendationSelect = selectCalls.find(
      (call) => call.table === "recommendation"
    );
    expect(recommendationSelect).toBeDefined();
    expect(recommendationSelect!.columns).not.toContain("motorcycle_id");
    expect(recommendationSelect!.columns).not.toContain("finding_id");
    expect(recommendationSelect!.columns).not.toContain("disposition");
  });

  it("skips the durable recommendation query in legacy mode", async () => {
    await listOutstandingRecommendationsForMotorcycle("motorcycle-1");

    expect(selectCalls.filter((call) => call.table === "recommendation")).toEqual([]);
  });
});
