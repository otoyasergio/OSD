import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function migrationSql(): string {
  const directory = join(process.cwd(), "supabase", "migrations");
  const file = readdirSync(directory).find((name) =>
    name.endsWith("_checkout_evidence_pickup_gates.sql")
  );
  expect(file).toBeTruthy();
  return readFileSync(join(directory, file!), "utf8");
}

describe("checkout evidence pickup-gate migration", () => {
  const sql = migrationSql();

  it("recreates the photo category check with existing plus five checkout categories", () => {
    expect(sql).toMatch(/drop\s+constraint\s+if\s+exists\s+intake_photo_category_check/i);
    expect(sql).toMatch(/add\s+constraint\s+intake_photo_category_check/i);
    for (const category of [
      "front",
      "job_proof",
      "job_work",
      "inspection_item",
      "checkout_front",
      "checkout_rear",
      "checkout_left_side",
      "checkout_right_side",
      "checkout_odometer",
    ]) {
      expect(sql).toContain(`'${category}'`);
    }
  });

  it("adds required/override columns with a false default so historical rows stay open", () => {
    expect(sql).toMatch(
      /checkout_evidence_required\s+boolean\s+not\s+null\s+default\s+false/i
    );
    expect(sql).toMatch(/checkout_evidence_override_at\s+timestamptz/i);
    expect(sql).toMatch(
      /checkout_evidence_override_by_user_id\s+uuid\s+references\s+app_user\s*\(\s*user_id\s*\)\s+on\s+delete\s+set\s+null/i
    );
    expect(sql).toMatch(/checkout_evidence_override_reason\s+text/i);
    expect(sql).toMatch(
      /checkout_evidence_override_all_or_nothing|override_all_or_nothing|checkout_evidence_override_consistent/i
    );
  });

  it("stamps override actor/time server-side and rejects non-owner/manager changes", () => {
    expect(sql).toMatch(/current_app_user_role\s*\(/i);
    expect(sql).toMatch(/current_app_user_id\s*\(/i);
    expect(sql).toMatch(/owner['"]?\s*,\s*['"]manager/i);
    expect(sql).toMatch(/checkout_evidence_override_by_user_id\s*(?:=|:=)\s*v_actor/i);
    expect(sql).toMatch(
      /checkout_evidence_override_at\s*(?:=|:=)\s*(now\(\)|clock_timestamp\(\))/i
    );
    expect(sql).toMatch(/FORBIDDEN|CHECKOUT_EVIDENCE_OVERRIDE_FORBIDDEN/i);
    expect(sql).toMatch(/OVERRIDE_REASON_REQUIRED/i);
  });

  it("blocks ready_for_pickup and completed when required evidence is missing", () => {
    expect(sql).toMatch(/ready_for_pickup/i);
    expect(sql).toMatch(/completed/i);
    expect(sql).toMatch(/CHECKOUT_EVIDENCE_REQUIRED/i);
    expect(sql).toMatch(/checkout_front/i);
    expect(sql).toMatch(/from\s+public\.intake_photo/i);
  });

  it("keeps the hand-maintained work_order type in sync", () => {
    const types = readFileSync(
      join(process.cwd(), "lib", "database", "supabase.generated.ts"),
      "utf8"
    );
    expect(types).toMatch(/checkout_evidence_required:\s*boolean/);
    expect(types).toMatch(/checkout_evidence_override_at:\s*string\s*\|\s*null/);
    expect(types).toMatch(/checkout_evidence_override_by_user_id:\s*string\s*\|\s*null/);
    expect(types).toMatch(/checkout_evidence_override_reason:\s*string\s*\|\s*null/);
  });
});
