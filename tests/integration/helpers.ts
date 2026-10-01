import { describe } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Integration tests only run against an explicitly configured ISOLATED
 * database (local `supabase start` or a disposable QA project) — never via
 * NEXT_PUBLIC_* variables, which may point at production.
 */

/** Production Supabase project ref. TEST_SUPABASE mutations are never allowed there. */
export const PRODUCTION_SUPABASE_REF = "eofxprepuajpqyvlolhw";

export type IntegrationTargetCheck = {
  configured: boolean;
  ok: boolean;
  reasons: string[];
};

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isHostedSupabaseUrl(url: string): boolean {
  const host = hostnameOf(url);
  if (host) return host === "supabase.co" || host.endsWith(".supabase.co");
  return url.includes(".supabase.co");
}

function containsProductionRef(value: string): boolean {
  return value.includes(PRODUCTION_SUPABASE_REF);
}

export function checkIntegrationTarget(
  env: Record<string, string | undefined> = process.env
): IntegrationTargetCheck {
  const url = env.TEST_SUPABASE_URL?.trim();
  const key = env.TEST_SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    return { configured: false, ok: true, reasons: [] };
  }

  const reasons: string[] = [];
  if (containsProductionRef(url) || containsProductionRef(key)) {
    reasons.push(
      `TEST_SUPABASE_URL or TEST_SUPABASE_SERVICE_ROLE_KEY points at the PRODUCTION Supabase project (${PRODUCTION_SUPABASE_REF}); service-role mutations are never allowed there.`
    );
  }
  if (isHostedSupabaseUrl(url) && env.TEST_ALLOW_REMOTE_SUPABASE !== "1") {
    reasons.push(
      "TEST_SUPABASE_URL is a hosted *.supabase.co project; set TEST_ALLOW_REMOTE_SUPABASE=1 to confirm it is a disposable isolated project. Local Supabase remains the default."
    );
  }
  return { configured: true, ok: reasons.length === 0, reasons };
}

export function assertSafeIntegrationTarget(
  env: Record<string, string | undefined> = process.env
): void {
  const result = checkIntegrationTarget(env);
  if (result.configured && !result.ok) {
    throw new Error(
      "Refusing TEST_SUPABASE mutations:\n" +
        result.reasons.map((reason) => `  - ${reason}`).join("\n")
    );
  }
}

export function integrationConfigured(
  env: Record<string, string | undefined> = process.env
): boolean {
  const result = checkIntegrationTarget(env);
  if (result.configured && !result.ok) {
    throw new Error(
      "Refusing TEST_SUPABASE mutations:\n" +
        result.reasons.map((reason) => `  - ${reason}`).join("\n")
    );
  }
  return result.configured;
}

/** `describe` when an isolated database is configured, `describe.skip` otherwise. */
export const describeIntegration = integrationConfigured() ? describe : describe.skip;

function requireTestUrl(env: Record<string, string | undefined> = process.env): string {
  assertSafeIntegrationTarget(env);
  const url = env.TEST_SUPABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "TEST_SUPABASE_URL is not set — run `supabase start` and export it from `supabase status -o env` (API_URL)."
    );
  }
  return url;
}

export function createServiceClient(
  env: Record<string, string | undefined> = process.env
): SupabaseClient {
  assertSafeIntegrationTarget(env);
  const key = env.TEST_SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) {
    throw new Error(
      "TEST_SUPABASE_SERVICE_ROLE_KEY is not set — export it from `supabase status -o env` (SERVICE_ROLE_KEY)."
    );
  }
  return createClient(requireTestUrl(env), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createAnonClient(
  env: Record<string, string | undefined> = process.env
): SupabaseClient {
  assertSafeIntegrationTarget(env);
  const key = env.TEST_SUPABASE_ANON_KEY?.trim();
  if (!key) {
    throw new Error(
      "TEST_SUPABASE_ANON_KEY is not set — export it from `supabase status -o env` (ANON_KEY)."
    );
  }
  return createClient(requireTestUrl(env), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
