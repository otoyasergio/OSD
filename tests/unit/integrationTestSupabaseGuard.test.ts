import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

describe("isolated Supabase integration guard", () => {
  it("never falls back from TEST_SUPABASE_* to NEXT_PUBLIC_* credentials", () => {
    const helpers = source("tests/integration/helpers.ts");
    expect(helpers).toMatch(/TEST_SUPABASE_URL/);
    expect(helpers).toMatch(/TEST_SUPABASE_SERVICE_ROLE_KEY/);
    expect(helpers).not.toMatch(/NEXT_PUBLIC_SUPABASE_URL\s*\?\?/);
    expect(helpers).not.toMatch(/process\.env\.NEXT_PUBLIC_SUPABASE/);
    expect(helpers).toMatch(/never via[\s/*]+NEXT_PUBLIC_/);
  });

  it("covers real intake RLS, RPC replay, and checkout trigger cases", () => {
    const test = source("tests/integration/intakePhotoPolicies.test.ts");
    expect(test).toMatch(/describeIntegration/);
    expect(test).toMatch(/finally/);
    expect(test).toMatch(/TEST_SUPABASE_URL/);
    expect(test).toMatch(/never NEXT_PUBLIC_/);
    expect(test).toMatch(
      /cannot UPDATE\/DELETE the object or DELETE the row|cannot update or delete/
    );
    expect(test).toMatch(/owner|manager/);
    expect(test).toMatch(/cross-location|foreign/);
    expect(test).toMatch(/malformed/);
    expect(test).toMatch(/client_upload_id/);
    expect(test).toMatch(/create_intake_photo_with_event/);
    expect(test).toMatch(/CHECKOUT_EVIDENCE_REQUIRED/);
    expect(test).toMatch(/CHECKOUT_EVIDENCE_REQUIRED_IMMUTABLE/);
    expect(test).toMatch(/reopen_work_order_for_recommendation_work/);
    expect(test).toMatch(/CHECKOUT_EVIDENCE_OVERRIDE_FORBIDDEN/);
  });
});
