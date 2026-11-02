import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function migrationSql(): string {
  const directory = join(process.cwd(), "supabase", "migrations");
  const file = readdirSync(directory).find((name) =>
    name.endsWith("_technician_note_realtime.sql")
  );
  expect(file).toBeTruthy();
  return readFileSync(join(directory, file!), "utf8");
}

describe("technician note realtime migration", () => {
  const sql = migrationSql();

  it("publishes technician notes and keeps work_order_id on the payload", () => {
    expect(sql).toMatch(
      /alter\s+table\s+public\.technician_note\s+replica\s+identity\s+full/i
    );
    expect(sql).toMatch(
      /alter\s+publication\s+supabase_realtime\s+add\s+table\s+public\.technician_note/i
    );
  });
});
