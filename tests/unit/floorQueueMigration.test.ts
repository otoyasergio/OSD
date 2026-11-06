import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20261105043000_floor_queue_standard_stops.sql"
  ),
  "utf8"
);

const partsWorkSql = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20261105203000_tech_can_work_while_waiting_for_parts.sql"
  ),
  "utf8"
);

const closedBikeSql = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20261105234500_floor_skips_closed_bikes.sql"
  ),
  "utf8"
);

describe("floor queue migration", () => {
  it("closes swapped and other blockers and stops writing a swap park", () => {
    expect(sql).toContain("kind IN ('swapped', 'other')");
    expect(sql).toContain("floor_park_reason IN ('swapped', 'other')");
    expect(sql).toContain("RAISE EXCEPTION 'START_BENCH_OCCUPIED'");
    expect(sql).not.toContain("floor_park_reason = 'swapped'");
    expect(sql).toContain("PARK_REASON_NOT_ALLOWED");
    expect(sql).toContain("workflow_v2_clear_tool_wait");
  });

  it("lets a parts-waiting job start and leaves the parts blocker open", () => {
    expect(partsWorkSql).toContain("'waiting_for_parts'");
    expect(partsWorkSql).toContain("AND kind = 'approval'");
    expect(partsWorkSql).not.toContain("kind IN ('approval', 'parts')");
    expect(partsWorkSql).toContain("OR target.status = 'waiting_for_approval'");
    expect(partsWorkSql).not.toContain("parts_blocked");
  });

  it("keeps closed and post-bay visits out of the next-bike line", () => {
    for (const status of [
      "completed",
      "cancelled",
      "on_hold",
      "safety_check",
      "ready_for_pickup",
      "in_storage",
      "insurance",
    ]) {
      expect(closedBikeSql).toContain(`'${status}'`);
    }
    expect(closedBikeSql).toContain("JOIN work_order line_wo");
    expect(closedBikeSql).toContain("floor_park_reason IN ('swapped', 'other')");
    expect(closedBikeSql).toContain("kind IN ('swapped', 'other')");
    expect(closedBikeSql).not.toContain("floor_park_reason = 'swapped'");
  });

  it("lets any assigned bike start and swaps the bike already on the bench", () => {
    const freedomSql = readFileSync(
      resolve(
        process.cwd(),
        "supabase/migrations/20261106040000_restore_tech_floor_freedom.sql"
      ),
      "utf8"
    );
    expect(freedomSql).toContain("bench_open");
    expect(freedomSql).toContain("floor_park_reason = 'swapped'");
    expect(freedomSql).toContain(
      "p_reason NOT IN ('parts', 'approval', 'tool', 'other')"
    );
    expect(freedomSql).toContain("RAISE EXCEPTION 'JOB_ASSIGNED_TO_OTHER_TECH'");
    expect(freedomSql).toContain("RAISE EXCEPTION 'WORK_ORDER_NOT_WORKABLE'");
    expect(freedomSql).not.toContain("START_BENCH_OCCUPIED");
    expect(freedomSql).not.toContain("START_NOT_NEXT");
    expect(freedomSql).toContain("'waiting_for_parts'");
  });

  it("lets any assigned bike start and still keeps one clock", () => {
    const anyOrderSql = readFileSync(
      resolve(
        process.cwd(),
        "supabase/migrations/20261106020000_start_any_assigned_bike.sql"
      ),
      "utf8"
    );
    expect(anyOrderSql).toContain("RAISE EXCEPTION 'START_BENCH_OCCUPIED'");
    expect(anyOrderSql).toContain("RAISE EXCEPTION 'JOB_ASSIGNED_TO_OTHER_TECH'");
    expect(anyOrderSql).not.toContain("START_NOT_NEXT");
    expect(anyOrderSql).not.toContain("docket_position");
  });
});
