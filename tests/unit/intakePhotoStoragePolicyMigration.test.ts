import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function migrationSql(): string {
  const directory = join(process.cwd(), "supabase", "migrations");
  const file = readdirSync(directory).find((name) =>
    name.endsWith("_intake_photo_evidence_storage_policies.sql")
  );
  expect(file).toBeTruthy();
  return readFileSync(join(directory, file!), "utf8");
}

describe("intake photo evidence storage policy migration", () => {
  const sql = migrationSql();

  it("drops every prior intake_photo DELETE policy name before creating one owner/manager policy", () => {
    expect(sql).toMatch(/drop\s+policy\s+if\s+exists\s+intake_photo_delete\b/i);
    expect(sql).toMatch(/drop\s+policy\s+if\s+exists\s+intake_photo_delete_location\b/i);
    expect(sql).toMatch(
      /drop\s+policy\s+if\s+exists\s+intake_photo_delete_owner_manager\b/i
    );
    expect(sql).toMatch(
      /create\s+policy\s+intake_photo_delete_owner_manager\s+on\s+public\.intake_photo/i
    );
    expect(sql).toMatch(/for\s+delete\s+to\s+authenticated/i);
    expect(sql).toMatch(
      /\(select\s+public\.current_app_user_role\(\)\)\s*=\s*any\s*\(\s*array\s*\[\s*'owner'::text\s*,\s*'manager'::text\s*\]\s*\)/i
    );
    expect(sql).toMatch(/public\.work_order_in_user_locations\(\s*work_order_id\s*\)/i);
    expect(sql).toMatch(/\(select\s+public\.is_active_app_user\(\)\)/i);
  });

  it("preserves location-scoped SELECT/INSERT and never adds an intake_photo UPDATE policy", () => {
    expect(sql).toMatch(/intake_photo_select_location/i);
    expect(sql).toMatch(/intake_photo_insert_location/i);
    expect(sql).not.toMatch(
      /create\s+policy\s+\S+\s+on\s+public\.intake_photo[\s\S]*for\s+update/i
    );
  });

  it("adds a fail-closed path helper and replaces intake-photos object policies without UPDATE", () => {
    expect(sql).toMatch(
      /create(?:\s+or\s+replace)?\s+function\s+public\.intake_photo_object_in_user_locations\s*\(\s*object_name\s+text\s*\)/i
    );
    expect(sql).toMatch(/split_part\s*\(\s*object_name\s*,\s*'\/'\s*,\s*1\s*\)/i);
    expect(sql).toMatch(
      /\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}/i
    );
    expect(sql).toMatch(/case\s+when/i);
    expect(sql).not.toMatch(/object_name\s*::\s*uuid/i);
    expect(sql).not.toMatch(/name\s*::\s*uuid/i);

    for (const name of [
      "intake_photos_select",
      "intake_photos_insert",
      "intake_photos_update",
      "intake_photos_delete",
      "intake_photos_select_location",
      "intake_photos_insert_location",
      "intake_photos_delete_owner_manager",
    ]) {
      expect(sql).toMatch(
        new RegExp(`drop\\s+policy\\s+if\\s+exists\\s+${name}\\b`, "i")
      );
    }

    expect(sql).toMatch(
      /create\s+policy\s+intake_photos_select_location\s+on\s+storage\.objects/i
    );
    expect(sql).toMatch(
      /create\s+policy\s+intake_photos_insert_location\s+on\s+storage\.objects/i
    );
    expect(sql).toMatch(
      /create\s+policy\s+intake_photos_delete_owner_manager\s+on\s+storage\.objects/i
    );
    expect(sql).not.toMatch(
      /create\s+policy\s+\S+\s+on\s+storage\.objects[\s\S]*for\s+update/i
    );
    expect(sql).toMatch(/intake_photo_object_in_user_locations\(\s*name\s*\)/i);
  });

  it("keeps the intake-photos bucket private with the existing 10 MB MIME allow-list", () => {
    expect(sql).toMatch(/storage\.buckets/i);
    expect(sql).toMatch(/public\s*=\s*false/i);
    expect(sql).toMatch(/10485760/);
    expect(sql).toMatch(/image\/jpeg/);
    expect(sql).toMatch(/image\/png/);
    expect(sql).toMatch(/image\/webp/);
    expect(sql).toMatch(/image\/heic/);
    expect(sql).toMatch(/image\/heif/);
  });

  it("keeps the hand-maintained database type in sync for the path helper", () => {
    const types = readFileSync(
      join(process.cwd(), "lib", "database", "supabase.generated.ts"),
      "utf8"
    );
    expect(types).toMatch(/intake_photo_object_in_user_locations:\s*\{/);
  });
});
