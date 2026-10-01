import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertSafeIntegrationTarget,
  checkIntegrationTarget,
  integrationConfigured,
} from "@/tests/integration/helpers";

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

const PRODUCTION_REF = "eofxprepuajpqyvlolhw";

function isolatedEnv(
  overrides: Record<string, string | undefined> = {}
): Record<string, string | undefined> {
  return {
    TEST_SUPABASE_URL: "http://127.0.0.1:54321",
    TEST_SUPABASE_SERVICE_ROLE_KEY: "isolated-service-role",
    TEST_SUPABASE_ANON_KEY: "isolated-anon",
    ...overrides,
  };
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
    expect(test).toMatch(/describeIntegration|describePhotoPolicies/);
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
    expect(test).toMatch(/CHECKOUT_EVIDENCE_NOT_READY/);
    expect(test).toMatch(/quality_checked_at/);
  });

  it("uses a unique unused object path for cross-location storage INSERT", () => {
    const test = source("tests/integration/intakePhotoPolicies.test.ts");
    expect(test).toMatch(/foreignObjectPath|objectPaths\.foreign/);
    expect(test).not.toMatch(/foreign\.storage[\s\S]{0,180}upload\(objectPaths\.tech/);
    expect(test).toMatch(/policy|row-level|unauthorized|403|denied|rls/i);
    expect(test).toMatch(/already exists|duplicate|23505/);
  });

  it("proves owner override unblocks ready_for_pickup and completed", () => {
    const test = source("tests/integration/intakePhotoPolicies.test.ts");
    expect(test).toMatch(
      /checkout_evidence_override_reason:\s*"Camera failed[\s\S]*ready_for_pickup[\s\S]*"completed"/
    );
  });

  it("never early-returns green when ANON_KEY is missing from a configured suite", () => {
    const test = source("tests/integration/intakePhotoPolicies.test.ts");
    expect(test).not.toMatch(
      /if\s*\(\s*!admin\s*\|\|\s*!process\.env\.TEST_SUPABASE_ANON_KEY\s*\)\s*return/
    );
    expect(test).not.toMatch(
      /if\s*\(\s*!process\.env\.TEST_SUPABASE_ANON_KEY\s*\)\s*return/
    );
    expect(test).toMatch(/TEST_SUPABASE_ANON_KEY/);
    expect(test).toMatch(/it\.skip\(/);
  });
});

describe("checkIntegrationTarget", () => {
  it("treats missing TEST_SUPABASE credentials as unconfigured, not unsafe", () => {
    expect(checkIntegrationTarget({})).toEqual({
      configured: false,
      ok: true,
      reasons: [],
    });
    expect(integrationConfigured({})).toBe(false);
  });

  it("accepts local Supabase without a remote-allow flag", () => {
    expect(checkIntegrationTarget(isolatedEnv())).toEqual({
      configured: true,
      ok: true,
      reasons: [],
    });
    expect(integrationConfigured(isolatedEnv())).toBe(true);
  });

  it("rejects the production project ref on TEST_SUPABASE_URL", () => {
    const result = checkIntegrationTarget(
      isolatedEnv({
        TEST_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co`,
        TEST_ALLOW_REMOTE_SUPABASE: "1",
      })
    );
    expect(result.configured).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.reasons.join("\n")).toMatch(new RegExp(PRODUCTION_REF));
    expect(result.reasons.join("\n")).toMatch(/PRODUCTION/i);
    expect(() =>
      integrationConfigured(
        isolatedEnv({
          TEST_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co`,
          TEST_ALLOW_REMOTE_SUPABASE: "1",
        })
      )
    ).toThrow(/PRODUCTION/);
  });

  it("rejects the production ref inside a service-role value", () => {
    const result = checkIntegrationTarget(
      isolatedEnv({
        TEST_SUPABASE_SERVICE_ROLE_KEY: `service-${PRODUCTION_REF}-role`,
      })
    );
    expect(result.ok).toBe(false);
    expect(result.reasons.join("\n")).toMatch(new RegExp(PRODUCTION_REF));
  });

  it("requires TEST_ALLOW_REMOTE_SUPABASE=1 for hosted disposable projects", () => {
    const hosted = isolatedEnv({
      TEST_SUPABASE_URL: "https://qa-disposable.supabase.co",
    });
    const blocked = checkIntegrationTarget(hosted);
    expect(blocked.ok).toBe(false);
    expect(blocked.reasons.join("\n")).toMatch(/TEST_ALLOW_REMOTE_SUPABASE/);
    expect(() => integrationConfigured(hosted)).toThrow(/TEST_ALLOW_REMOTE_SUPABASE/);

    const allowed = checkIntegrationTarget({
      ...hosted,
      TEST_ALLOW_REMOTE_SUPABASE: "1",
    });
    expect(allowed).toEqual({ configured: true, ok: true, reasons: [] });
  });

  it("never contacts production from the unit guard", () => {
    expect(source("tests/integration/helpers.ts")).not.toMatch(
      /createClient\([\s\S]*eofxprepuajpqyvlolhw/
    );
    expect(() =>
      assertSafeIntegrationTarget(
        isolatedEnv({
          TEST_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co`,
          TEST_ALLOW_REMOTE_SUPABASE: "1",
        })
      )
    ).toThrow(/PRODUCTION/);
  });
});
