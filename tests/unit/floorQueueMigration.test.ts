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

describe("floor queue migration", () => {
  it("closes swapped and other blockers and stops writing a swap park", () => {
    expect(sql).toContain("kind IN ('swapped', 'other')");
    expect(sql).toContain("floor_park_reason IN ('swapped', 'other')");
    expect(sql).toContain("RAISE EXCEPTION 'START_BENCH_OCCUPIED'");
    expect(sql).not.toContain("floor_park_reason = 'swapped'");
    expect(sql).toContain("PARK_REASON_NOT_ALLOWED");
    expect(sql).toContain("workflow_v2_clear_tool_wait");
  });
});
