import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REQUIRED_MIGRATIONS = [
  "intake_photo_upload_idempotency.sql",
  "checkout_evidence_pickup_gates.sql",
  "checkout_evidence_review_fixes.sql",
  "intake_photo_evidence_storage_policies.sql",
  "checkout_photo_insert_ready_gate.sql",
  "intake_photo_rpc_checkout_labels.sql",
];

describe("Safari photo schema and generated types", () => {
  it("keeps new photo/checkout migrations ordered by filename", () => {
    const directory = join(process.cwd(), "supabase", "migrations");
    const files = readdirSync(directory)
      .filter((name) => name.endsWith(".sql"))
      .sort();
    const indexes = REQUIRED_MIGRATIONS.map((suffix) => {
      const index = files.findIndex((name) => name.endsWith(suffix));
      expect(index, suffix).toBeGreaterThan(-1);
      return index;
    });
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
  });

  it("includes client upload, checkout, and path-helper types", () => {
    const types = readFileSync(
      join(process.cwd(), "lib", "database", "supabase.generated.ts"),
      "utf8"
    );
    for (const token of [
      "client_upload_id",
      "checkout_evidence_required",
      "checkout_evidence_override_at",
      "checkout_evidence_override_by_user_id",
      "checkout_evidence_override_reason",
      "create_intake_photo_with_event",
      "reopen_work_order_for_recommendation_work",
      "intake_photo_object_in_user_locations",
    ]) {
      expect(types).toContain(token);
    }
    const handTypes = readFileSync(
      join(process.cwd(), "lib", "database", "types.ts"),
      "utf8"
    );
    for (const category of [
      "checkout_front",
      "checkout_rear",
      "checkout_left_side",
      "checkout_right_side",
      "checkout_odometer",
    ]) {
      expect(handTypes).toContain(category);
    }
  });
});
