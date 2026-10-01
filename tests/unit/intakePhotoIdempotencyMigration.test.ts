import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function migrationSql(): string {
  const directory = join(process.cwd(), "supabase", "migrations");
  const file = readdirSync(directory).find((name) =>
    name.endsWith("_intake_photo_upload_idempotency.sql")
  );
  expect(file).toBeTruthy();
  return readFileSync(join(directory, file!), "utf8");
}

describe("intake photo upload idempotency migration", () => {
  const sql = migrationSql();

  it("adds nullable client identity and canonical JPEG metadata", () => {
    expect(sql).toMatch(/add\s+column\s+if\s+not\s+exists\s+client_upload_id\s+uuid/i);
    expect(sql).toMatch(/add\s+column\s+if\s+not\s+exists\s+content_type\s+text/i);
    expect(sql).toMatch(/add\s+column\s+if\s+not\s+exists\s+byte_size\s+bigint/i);
    expect(sql).toMatch(/add\s+column\s+if\s+not\s+exists\s+pixel_width\s+integer/i);
    expect(sql).toMatch(/add\s+column\s+if\s+not\s+exists\s+pixel_height\s+integer/i);
  });

  it("enforces non-null upload IDs uniquely with valid canonical metadata", () => {
    expect(sql).toMatch(
      /create\s+unique\s+index[\s\S]*on\s+public\.intake_photo\s*\(\s*client_upload_id\s*\)[\s\S]*where\s+client_upload_id\s+is\s+not\s+null/i
    );
    expect(sql).toMatch(
      /check\s*\(\s*content_type\s+is\s+null\s+or\s+content_type\s*=\s*'image\/jpeg'\s*\)/i
    );
    expect(sql).toMatch(
      /check\s*\(\s*byte_size\s+is\s+null\s+or\s+byte_size\s*>\s*0\s*\)/i
    );
    expect(sql).toMatch(
      /check\s*\(\s*pixel_width\s+is\s+null\s+or\s+pixel_width\s*>\s*0\s*\)/i
    );
    expect(sql).toMatch(
      /check\s*\(\s*pixel_height\s+is\s+null\s+or\s+pixel_height\s*>\s*0\s*\)/i
    );
  });

  it("keeps the hand-maintained database type in sync", () => {
    const types = readFileSync(
      join(process.cwd(), "lib", "database", "supabase.generated.ts"),
      "utf8"
    );
    expect(types).toMatch(/intake_photo:\s*\{/);
    for (const field of [
      "client_upload_id",
      "content_type",
      "byte_size",
      "pixel_width",
      "pixel_height",
    ]) {
      expect(types).toMatch(new RegExp(`${field}: [^;]+ \\| null;`));
    }
  });
});
