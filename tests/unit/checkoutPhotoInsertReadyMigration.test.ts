import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function migrationSql(): string {
  const directory = join(process.cwd(), "supabase", "migrations");
  const file = readdirSync(directory).find((name) =>
    name.endsWith("_checkout_photo_insert_ready_gate.sql")
  );
  expect(file).toBeTruthy();
  return readFileSync(join(directory, file!), "utf8");
}

describe("checkout photo insert ready-gate migration", () => {
  it("adds a trigger on checkout-category INSERT that raises CHECKOUT_EVIDENCE_NOT_READY", () => {
    const sql = migrationSql();
    expect(sql).toMatch(
      /create(?:\s+or\s+replace)?\s+function\s+public\.enforce_checkout_photo_insert_ready/i
    );
    expect(sql).toMatch(/before\s+insert\s+on\s+public\.intake_photo/i);
    expect(sql).toMatch(/CHECKOUT_EVIDENCE_NOT_READY/);
    for (const category of [
      "checkout_front",
      "checkout_rear",
      "checkout_left_side",
      "checkout_right_side",
      "checkout_odometer",
    ]) {
      expect(sql).toContain(`'${category}'`);
    }
    expect(sql).toMatch(/quality_checked_at/);
    expect(sql).toMatch(/quality_checked_by_user_id/);
    expect(sql).toMatch(/from\s+public\.job/i);
    expect(sql).toMatch(/cancelled|declined/);
    expect(sql).toMatch(/completed/);
    expect(sql).toMatch(/security\s+invoker/i);
  });

  it("does not gate legacy non-checkout categories", () => {
    const sql = migrationSql();
    expect(sql).toMatch(/not\s+in\s*\(|NEW\.category\s+not\s+in/i);
    expect(sql).not.toMatch(
      /RAISE EXCEPTION 'CHECKOUT_EVIDENCE_NOT_READY'[\s\S]*front'/i
    );
  });

  it("caps override reasons at 500 characters", () => {
    const sql = migrationSql();
    expect(sql).toMatch(/checkout_evidence_override_reason/i);
    expect(sql).toMatch(/500/);
    expect(sql).toMatch(/char_length|length\s*\(/i);
  });
});
