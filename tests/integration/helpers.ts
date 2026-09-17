import { describe } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Integration tests only run against an explicitly configured ISOLATED
 * database (local `supabase start` or a disposable QA project) — never via
 * NEXT_PUBLIC_* variables, which may point at production.
 */
export function integrationConfigured(): boolean {
  return Boolean(
    process.env.TEST_SUPABASE_URL && process.env.TEST_SUPABASE_SERVICE_ROLE_KEY
  );
}

/** `describe` when an isolated database is configured, `describe.skip` otherwise. */
export const describeIntegration = integrationConfigured() ? describe : describe.skip;

function requireTestUrl(): string {
  const url = process.env.TEST_SUPABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_SUPABASE_URL is not set — run `supabase start` and export it from `supabase status -o env` (API_URL)."
    );
  }
  return url;
}

export function createServiceClient(): SupabaseClient {
  const key = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "TEST_SUPABASE_SERVICE_ROLE_KEY is not set — export it from `supabase status -o env` (SERVICE_ROLE_KEY)."
    );
  }
  return createClient(requireTestUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createAnonClient(): SupabaseClient {
  const key = process.env.TEST_SUPABASE_ANON_KEY;
  if (!key) {
    throw new Error(
      "TEST_SUPABASE_ANON_KEY is not set — export it from `supabase status -o env` (ANON_KEY)."
    );
  }
  return createClient(requireTestUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
