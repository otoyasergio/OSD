import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function migrationSql(): string {
  const directory = join(process.cwd(), "supabase", "migrations");
  const file = readdirSync(directory).find((name) =>
    name.endsWith("_intake_photo_rpc_checkout_labels.sql")
  );
  expect(file).toBeTruthy();
  return readFileSync(join(directory, file!), "utf8");
}

describe("intake photo RPC checkout labels migration", () => {
  it("is a follow-up CREATE OR REPLACE of create_intake_photo_with_event", () => {
    const sql = migrationSql();
    expect(sql).toMatch(
      /create\s+or\s+replace\s+function\s+public\.create_intake_photo_with_event/i
    );
    expect(sql).toMatch(/security\s+invoker/i);
  });

  it("maps each checkout category to the staff label", () => {
    const sql = migrationSql();
    expect(sql).toMatch(/when\s+'checkout_front'\s+then\s+'Checkout — Front'/i);
    expect(sql).toMatch(/when\s+'checkout_rear'\s+then\s+'Checkout — Rear'/i);
    expect(sql).toMatch(/when\s+'checkout_left_side'\s+then\s+'Checkout — Left Side'/i);
    expect(sql).toMatch(/when\s+'checkout_right_side'\s+then\s+'Checkout — Right Side'/i);
    expect(sql).toMatch(/when\s+'checkout_odometer'\s+then\s+'Checkout — Odometer'/i);
  });
});
