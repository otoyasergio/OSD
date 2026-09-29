import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function migrationSql(): string {
  const directory = join(process.cwd(), "supabase", "migrations");
  const file = readdirSync(directory).find((name) =>
    name.endsWith("_platform_hardening.sql")
  );
  expect(file).toBeTruthy();
  return readFileSync(join(directory, file!), "utf8");
}

describe("platform hardening migration", () => {
  const sql = migrationSql();

  it("documents an explicit deny policy for webhook event data", () => {
    expect(sql).toMatch(/create\s+policy\s+square_webhook_event_no_client_access/i);
    expect(sql).toMatch(/using\s*\(\s*false\s*\)/i);
    expect(sql).toMatch(/with\s+check\s*\(\s*false\s*\)/i);
    expect(sql).toMatch(
      /revoke\s+all\s+on\s+table\s+public\.square_webhook_event\s+from\s+anon,\s*authenticated/i
    );
  });

  it("removes direct authenticated access to internal authorization helpers", () => {
    expect(sql).toMatch(
      /revoke\s+execute\s+on\s+function\s+public\.workflow_v2_job_authorization\(uuid\)\s+from\s+authenticated/i
    );
    expect(sql).toMatch(
      /revoke\s+execute\s+on\s+function\s+public\.workflow_v2_job_is_authorized\(uuid\)\s+from\s+authenticated/i
    );
    expect(sql).toMatch(
      /revoke\s+execute\s+on\s+function\s+public\.mint_work_order_number\(uuid\)\s+from\s+authenticated/i
    );
    expect(sql).toMatch(
      /create\s+or\s+replace\s+function\s+public\.mint_work_order_number/i
    );
    expect(sql).not.toMatch(/if\s+not\s+public\.is_active_app_user\(\)/i);
  });

  it("adds only targeted indexes used by live relationship queries", () => {
    expect(sql).toMatch(
      /create\s+index\s+if\s+not\s+exists\s+idx_technician_note_job_id/i
    );
    expect(sql).toMatch(
      /create\s+index\s+if\s+not\s+exists\s+idx_chat_attachment_message_id/i
    );
    expect(sql).toMatch(
      /create\s+index\s+if\s+not\s+exists\s+idx_chat_call_conversation_id/i
    );
    expect(sql).toMatch(
      /create\s+index\s+if\s+not\s+exists\s+idx_recommendation_inspection_result_id/i
    );
  });

  it("keeps local and QA Realtime identity aligned with production", () => {
    expect(sql).toMatch(
      /alter\s+table\s+public\.staff_notification\s+replica\s+identity\s+full/i
    );
  });

  it("keeps work-order sequence counters owner-seeded and server-managed", () => {
    expect(sql).toMatch(
      /revoke\s+all\s+on\s+table\s+public\.work_order_sequence\s+from\s+anon,\s*authenticated/i
    );
    expect(sql).toMatch(
      /grant\s+insert\s+on\s+table\s+public\.work_order_sequence\s+to\s+authenticated/i
    );
    expect(sql).toMatch(/create\s+policy\s+work_order_sequence_insert_owner/i);
    expect(sql).not.toMatch(/create\s+policy\s+work_order_sequence_update/i);
  });
});
