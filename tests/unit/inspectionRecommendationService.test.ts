import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUser } from "@/lib/auth/session";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createClient: vi.fn(),
  addAuditLog: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireUser: mocks.requireUser,
}));

vi.mock("@/lib/database/supabase-server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("@/lib/database/supabase-admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/audit/addAuditLog", () => ({
  addAuditLog: mocks.addAuditLog,
}));

vi.mock("@/lib/timeline/addTimelineEvent", () => ({
  addTimelineEvent: vi.fn(),
}));

import {
  getInspectionRecommendationDraft,
  saveRecommendationFromInspectionResult,
} from "@/lib/services/recommendations";
import { setOptionalColumnSupport } from "@/lib/database/schemaCompat";

const RESULT_ID = "10000000-0000-4000-8000-000000000001";

type Row = Record<string, unknown>;
type QueryFilter =
  | { kind: "eq"; column: string; value: unknown }
  | { kind: "is"; column: string; value: unknown }
  | { kind: "or"; expression: string };

type QueryCall = {
  table: string;
  operation: "select" | "update" | "insert";
  columns: string | null;
  filters: QueryFilter[];
};

class StatefulRecommendationDb {
  readonly tables: Record<string, Row[]>;
  readonly calls: QueryCall[] = [];
  beforeRecommendationUpdate: ((db: StatefulRecommendationDb) => void) | null = null;

  constructor(tables: Record<string, Row[]>) {
    this.tables = tables;
  }

  from(table: string) {
    return new StatefulQuery(this, table);
  }

  recommendationInsertCount() {
    return this.calls.filter(
      (call) => call.table === "recommendation" && call.operation === "insert"
    ).length;
  }
}

class StatefulQuery {
  private operation: QueryCall["operation"] = "select";
  private columns: string | null = null;
  private filters: QueryFilter[] = [];
  private patch: Row | null = null;
  private insertValues: Row | Row[] | null = null;
  private orderBy: { column: string; ascending: boolean } | null = null;
  private rowLimit: number | null = null;

  constructor(
    private readonly db: StatefulRecommendationDb,
    private readonly table: string
  ) {}

  select(columns: string) {
    this.columns = columns;
    return this;
  }

  update(patch: Row) {
    this.operation = "update";
    this.patch = patch;
    return this;
  }

  insert(values: Row | Row[]) {
    this.operation = "insert";
    this.insertValues = values;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ kind: "eq", column, value });
    return this;
  }

  is(column: string, value: unknown) {
    this.filters.push({ kind: "is", column, value });
    return this;
  }

  or(expression: string) {
    this.filters.push({ kind: "or", expression });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orderBy = { column, ascending: options?.ascending !== false };
    return this;
  }

  limit(value: number) {
    this.rowLimit = value;
    return this;
  }

  async maybeSingle() {
    const rows = this.execute();
    return { data: rows[0] ?? null, error: null };
  }

  async single() {
    const rows = this.execute();
    return { data: rows[0] ?? null, error: null };
  }

  private execute(): Row[] {
    if (
      this.table === "recommendation" &&
      this.operation === "update" &&
      this.db.beforeRecommendationUpdate
    ) {
      const hook = this.db.beforeRecommendationUpdate;
      this.db.beforeRecommendationUpdate = null;
      hook(this.db);
    }

    this.db.calls.push({
      table: this.table,
      operation: this.operation,
      columns: this.columns,
      filters: this.filters.map((filter) => ({ ...filter })),
    });

    if (this.operation === "insert") {
      const values = Array.isArray(this.insertValues)
        ? this.insertValues
        : [this.insertValues ?? {}];
      const inserted = values.map((value, index) => ({
        recommendation_id:
          value.recommendation_id ?? `inserted-recommendation-${index + 1}`,
        created_at: value.created_at ?? "2026-08-21T13:00:00.000Z",
        converted_job_id: value.converted_job_id ?? null,
        resolved_at: value.resolved_at ?? null,
        ...value,
      }));
      this.db.tables[this.table] ??= [];
      this.db.tables[this.table].push(...inserted);
      return inserted.map((row) => ({ ...row }));
    }

    let rows = (this.db.tables[this.table] ?? []).filter((row) =>
      this.filters.every((filter) => matchesFilter(row, filter))
    );
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      rows = [...rows].sort((left, right) => {
        const leftValue = String(left[column] ?? "");
        const rightValue = String(right[column] ?? "");
        return (leftValue.localeCompare(rightValue) || 0) * (ascending ? 1 : -1);
      });
    }
    if (this.rowLimit !== null) rows = rows.slice(0, this.rowLimit);

    if (this.operation === "update") {
      for (const row of rows) Object.assign(row, this.patch);
    }
    return rows.map((row) => ({ ...row }));
  }
}

function matchesFilter(row: Row, filter: QueryFilter): boolean {
  if (filter.kind === "eq") return row[filter.column] === filter.value;
  if (filter.kind === "is") return row[filter.column] === filter.value;
  if (filter.expression === "disposition.eq.open,disposition.is.null") {
    return row.disposition === "open" || row.disposition == null;
  }
  throw new Error(`Unsupported test filter: ${filter.expression}`);
}

function user(overrides: Partial<AppUser> = {}): AppUser {
  return {
    user_id: "tech-1",
    auth_user_id: "auth-1",
    first_name: "Taylor",
    last_name: "Tech",
    email: "tech@example.com",
    profile_photo_path: null,
    role: "service_advisor",
    status: "active",
    location_ids: ["location-1"],
    active_location_id: "location-1",
    ...overrides,
  };
}

function database(
  options: {
    owningWorkOrderId?: string;
    resultStatus?: string | null;
    recommendation?: Row | null;
    assignedTechnicianId?: string | null;
  } = {}
) {
  const workOrderId = "work-order-1";
  const recommendation =
    options.recommendation === undefined
      ? {
          recommendation_id: "recommendation-1",
          work_order_id: workOrderId,
          inspection_result_id: RESULT_ID,
          created_by_user_id: "tech-1",
          description: "Front brake lining (Brakes & Tires)",
          severity: "future_attention",
          status: "pending",
          converted_job_id: null,
          notes: "Original note",
          created_at: "2026-08-21T12:00:00.000Z",
          resolved_at: null,
        }
      : options.recommendation;

  return new StatefulRecommendationDb({
    inspection_result: [
      {
        inspection_result_id: RESULT_ID,
        item_name_snapshot: "Front brake lining",
        category_snapshot: "Brakes & Tires",
        status: options.resultStatus ?? "future_attention",
        notes: "Inspection note",
        inspection: {
          work_order_id: options.owningWorkOrderId ?? workOrderId,
        },
      },
    ],
    work_order: [
      {
        work_order_id: workOrderId,
        location_id: "location-1",
        work_order_number: "WO-1001",
        status: "inspection_in_progress",
        motorcycle_id: "motorcycle-1",
        primary_technician_id: null,
        quality_check_assigned_to: null,
        job: [
          {
            assigned_technician_id:
              options.assignedTechnicianId === undefined
                ? "tech-2"
                : options.assignedTechnicianId,
          },
        ],
      },
    ],
    recommendation: recommendation ? [recommendation] : [],
  });
}

async function save() {
  return saveRecommendationFromInspectionResult("work-order-1", RESULT_ID, {
    description: "Edited brake recommendation",
    severity: "immediate_attention",
    notes: "Replace immediately",
  });
}

describe("inspection recommendation service query behavior", () => {
  beforeEach(() => {
    vi.stubEnv("JOBS_ESTIMATE_V2_KILL_SWITCH", "0");
    vi.stubEnv("JOBS_ESTIMATE_V2_READ_MODE", "legacy");
    vi.stubEnv("JOBS_ESTIMATE_V2_WRITE_MODE", "legacy");
    mocks.requireUser.mockResolvedValue(user());
    mocks.addAuditLog.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("updates the existing linked pending row without inserting", async () => {
    const db = database();
    mocks.createClient.mockResolvedValue(db);

    await expect(save()).resolves.toMatchObject({
      recommendation_id: "recommendation-1",
      work_order_id: "work-order-1",
      description: "Edited brake recommendation",
      severity: "immediate_attention",
      notes: "Replace immediately",
    });
    expect(db.tables.recommendation).toHaveLength(1);
    expect(db.recommendationInsertCount()).toBe(0);

    const update = db.calls.find(
      (call) => call.table === "recommendation" && call.operation === "update"
    );
    expect(update?.filters).toEqual(
      expect.arrayContaining([
        { kind: "eq", column: "recommendation_id", value: "recommendation-1" },
        { kind: "eq", column: "work_order_id", value: "work-order-1" },
        {
          kind: "eq",
          column: "inspection_result_id",
          value: RESULT_ID,
        },
        { kind: "eq", column: "status", value: "pending" },
        { kind: "is", column: "converted_job_id", value: null },
      ])
    );
    expect(update?.filters.some((filter) => filter.kind === "or")).toBe(false);

    const linkedSelect = db.calls.find(
      (call) =>
        call.table === "recommendation" &&
        call.operation === "select" &&
        call.columns?.includes("recommendation_id")
    );
    expect(linkedSelect?.columns).not.toContain("disposition");
  });

  it("returns a named error and inserts nothing when the automatic row is missing", async () => {
    const db = database({ recommendation: null });
    mocks.createClient.mockResolvedValue(db);

    await expect(save()).rejects.toThrow("INSPECTION_RECOMMENDATION_MISSING");
    expect(db.tables.recommendation).toHaveLength(0);
    expect(db.recommendationInsertCount()).toBe(0);
  });

  it.each(["draft", "save"] as const)(
    "rejects a mismatched expected work order in the %s service",
    async (operation) => {
      const db = database({ owningWorkOrderId: "work-order-2" });
      mocks.createClient.mockResolvedValue(db);

      const promise =
        operation === "draft"
          ? getInspectionRecommendationDraft("work-order-1", RESULT_ID)
          : save();
      await expect(promise).rejects.toThrow("INSPECTION_RESULT_NOT_FOUND");
      expect(db.recommendationInsertCount()).toBe(0);
      expect(db.calls.some((call) => call.table === "recommendation")).toBe(false);
    }
  );

  it.each(["draft", "save"] as const)(
    "denies an unassigned same-location floor technician in the %s service",
    async (operation) => {
      const db = database({ assignedTechnicianId: "tech-2" });
      mocks.createClient.mockResolvedValue(db);
      mocks.requireUser.mockResolvedValue(user({ role: "technician" }));

      const promise =
        operation === "draft"
          ? getInspectionRecommendationDraft("work-order-1", RESULT_ID)
          : save();
      await expect(promise).rejects.toThrow("FORBIDDEN");
      expect(db.recommendationInsertCount()).toBe(0);
      expect(db.calls.some((call) => call.table === "recommendation")).toBe(false);
    }
  );

  it("keeps front-office access on an unassigned work order", async () => {
    const db = database({ assignedTechnicianId: "tech-2" });
    mocks.createClient.mockResolvedValue(db);
    mocks.requireUser.mockResolvedValue(user({ role: "service_advisor" }));

    await expect(
      getInspectionRecommendationDraft("work-order-1", RESULT_ID)
    ).resolves.toEqual({
      description: "Front brake lining (Brakes & Tires)",
      severity: "future_attention",
      notes: "Original note",
    });
  });

  it.each(["ok", "not_applicable"] as const)(
    "rejects save when the current inspection result is %s",
    async (status) => {
      const db = database({ resultStatus: status });
      mocks.createClient.mockResolvedValue(db);

      await expect(save()).rejects.toThrow("INSPECTION_RECOMMENDATION_NOT_ACTIONABLE");
      expect(
        db.calls.some(
          (call) => call.table === "recommendation" && call.operation === "update"
        )
      ).toBe(false);
    }
  );

  it("does not edit a row actioned between the load and guarded update", async () => {
    const db = database();
    db.beforeRecommendationUpdate = (state) => {
      state.tables.recommendation[0].status = "deferred";
    };
    mocks.createClient.mockResolvedValue(db);

    await expect(save()).rejects.toThrow("RECOMMENDATION_ALREADY_ACTIONED");
    expect(db.tables.recommendation[0].description).toBe(
      "Front brake lining (Brakes & Tires)"
    );
    expect(db.recommendationInsertCount()).toBe(0);
  });

  it("does not recreate a legacy row deleted by a concurrent clear", async () => {
    const db = database();
    db.beforeRecommendationUpdate = (state) => {
      state.tables.recommendation.splice(0);
    };
    mocks.createClient.mockResolvedValue(db);

    await expect(save()).rejects.toThrow("INSPECTION_RECOMMENDATION_MISSING");
    expect(db.tables.recommendation).toHaveLength(0);
    expect(db.recommendationInsertCount()).toBe(0);
  });

  it("guards a V2 update against a concurrently voided disposition", async () => {
    vi.stubEnv("JOBS_ESTIMATE_V2_WRITE_MODE", "dual");
    setOptionalColumnSupport("recommendation.disposition", true);
    const db = database({
      recommendation: {
        recommendation_id: "recommendation-1",
        work_order_id: "work-order-1",
        inspection_result_id: RESULT_ID,
        created_by_user_id: "tech-1",
        description: "Front brake lining (Brakes & Tires)",
        severity: "future_attention",
        status: "pending",
        converted_job_id: null,
        notes: "Original note",
        created_at: "2026-08-21T12:00:00.000Z",
        resolved_at: null,
        disposition: "open",
      },
    });
    db.beforeRecommendationUpdate = (state) => {
      state.tables.recommendation[0].disposition = "void";
    };
    mocks.createClient.mockResolvedValue(db);

    await expect(save()).rejects.toThrow("INSPECTION_RECOMMENDATION_MISSING");
    expect(db.tables.recommendation[0].description).toBe(
      "Front brake lining (Brakes & Tires)"
    );
    const update = db.calls.find(
      (call) => call.table === "recommendation" && call.operation === "update"
    );
    expect(update?.filters).toContainEqual({
      kind: "or",
      expression: "disposition.eq.open,disposition.is.null",
    });
    expect(db.recommendationInsertCount()).toBe(0);
  });

  it("allows a null V2 disposition while applying the open/null update guard", async () => {
    vi.stubEnv("JOBS_ESTIMATE_V2_WRITE_MODE", "dual");
    setOptionalColumnSupport("recommendation.disposition", true);
    const db = database();
    db.tables.recommendation[0].disposition = null;
    mocks.createClient.mockResolvedValue(db);

    await expect(save()).resolves.toMatchObject({
      recommendation_id: "recommendation-1",
      description: "Edited brake recommendation",
    });
    const update = db.calls.find(
      (call) => call.table === "recommendation" && call.operation === "update"
    );
    expect(update?.filters).toContainEqual({
      kind: "or",
      expression: "disposition.eq.open,disposition.is.null",
    });
  });
});
