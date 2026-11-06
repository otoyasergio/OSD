import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireUser, createClient, addTimelineEvent, addAuditLog } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createClient: vi.fn(),
  addTimelineEvent: vi.fn(),
  addAuditLog: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ requireUser }));
vi.mock("@/lib/database/supabase-server", () => ({ createClient }));
vi.mock("@/lib/timeline/addTimelineEvent", () => ({ addTimelineEvent }));
vi.mock("@/lib/audit/addAuditLog", () => ({ addAuditLog }));

import { saveInspectionResult } from "@/lib/services/inspections";

const RESULT = "f2222222-2222-4222-8222-222222222222";
const LOADED_AT = "2026-11-03T12:00:00+00:00";

function storedLine() {
  return {
    inspection_result_id: RESULT,
    inspection_id: "e2222222-2222-4222-8222-222222222222",
    template_item_id: "t2222222-2222-4222-8222-222222222222",
    category_snapshot: "Brakes",
    item_name_snapshot: "Front brake lining",
    display_order_snapshot: 1,
    requires_measurement_snapshot: true,
    status: "ok",
    measurement: "4.5",
    measurement_unit: "mm",
    measurement_source: null,
    angle_after_torque: false,
    replace_fastener: false,
    notes: null as string | null,
    updated_by_user_id: "user-2",
    updated_at: LOADED_AT,
    inspection: {
      inspection_id: "e2222222-2222-4222-8222-222222222222",
      work_order_id: "42222222-2222-4222-8222-222222222222",
      started_at: "2026-11-03T11:00:00+00:00",
      completed_at: null,
      work_order: {
        work_order_id: "42222222-2222-4222-8222-222222222222",
        location_id: "loc-1",
        work_order_number: "WO-220",
        status: "inspection_in_progress",
      },
    },
  };
}

type Write = { values: Record<string, unknown>; filters: Record<string, unknown> };

/** A database holding one line. A write lands only if every filter matches it. */
function database(line: ReturnType<typeof storedLine>) {
  const writes: Write[] = [];
  let beforeWrite: (() => void) | null = null;
  const client = {
    from(table: string) {
      if (table !== "inspection_result") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { ...line }, error: null }),
          }),
        }),
        update(values: Record<string, unknown>) {
          const filters: Record<string, unknown> = {};
          const chain = {
            eq(column: string, value: unknown) {
              filters[column] = value;
              return chain;
            },
            select: () => ({
              maybeSingle: async () => {
                beforeWrite?.();
                const stored = line as unknown as Record<string, unknown>;
                const matches = Object.entries(filters).every(
                  ([column, value]) => stored[column] === value
                );
                if (!matches) return { data: null, error: null };
                Object.assign(line, values);
                writes.push({ values, filters });
                const { inspection: _inspection, ...saved } = line;
                return { data: saved, error: null };
              },
            }),
          };
          return chain;
        },
      };
    },
  };
  return {
    client,
    writes,
    onNextWrite(run: () => void) {
      beforeWrite = () => {
        beforeWrite = null;
        run();
      };
    },
  };
}

describe("saveInspectionResult refuses a save made against an older line", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({
      user_id: "user-1",
      role: "service_advisor",
      active_location_id: "loc-1",
      location_ids: ["loc-1"],
    });
  });

  it("saves when the line is still the version the device loaded", async () => {
    const line = storedLine();
    const db = database(line);
    createClient.mockResolvedValue(db.client);

    const saved = await saveInspectionResult(RESULT, {
      measurement: "3.9",
      expected_updated_at: "2026-11-03T12:00:00.000Z",
    });

    expect(saved.measurement).toBe("3.9");
    expect(db.writes).toHaveLength(1);
    expect(db.writes[0].filters).toEqual({
      inspection_result_id: RESULT,
      updated_at: LOADED_AT,
    });
    expect(saved.updated_at).not.toBe(LOADED_AT);
  });

  it("refuses when another device saved the line after this one loaded it", async () => {
    const line = storedLine();
    line.updated_at = "2026-11-03T12:04:00+00:00";
    line.notes = "Pads replaced";
    const db = database(line);
    createClient.mockResolvedValue(db.client);

    await expect(
      saveInspectionResult(RESULT, {
        measurement: "3.9",
        notes: null,
        expected_updated_at: LOADED_AT,
      })
    ).rejects.toThrow("INSPECTION_RESULT_CHANGED");

    expect(db.writes).toHaveLength(0);
    expect(line.notes).toBe("Pads replaced");
  });

  it("refuses when another save lands between reading the line and writing it", async () => {
    const line = storedLine();
    const db = database(line);
    createClient.mockResolvedValue(db.client);
    db.onNextWrite(() => {
      line.updated_at = "2026-11-03T12:04:00+00:00";
      line.measurement = "5.1";
    });

    await expect(
      saveInspectionResult(RESULT, {
        measurement: "3.9",
        expected_updated_at: LOADED_AT,
      })
    ).rejects.toThrow("INSPECTION_RESULT_CHANGED");

    expect(line.measurement).toBe("5.1");
  });

  it("does not touch the line when the save changes nothing", async () => {
    const line = storedLine();
    line.updated_at = "2026-11-03T12:04:00+00:00";
    const db = database(line);
    createClient.mockResolvedValue(db.client);

    const saved = await saveInspectionResult(RESULT, {
      measurement: "4.5",
      measurement_unit: "mm",
      notes: null,
      expected_updated_at: LOADED_AT,
    });

    expect(db.writes).toHaveLength(0);
    expect(saved.updated_at).toBe("2026-11-03T12:04:00+00:00");
  });
});
