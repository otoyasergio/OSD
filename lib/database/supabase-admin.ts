import { createClient } from "@supabase/supabase-js";

function createServiceRoleClient(configurationError: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(configurationError);
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Service-role client for privileged server jobs (Parts Canada catalog sync).
 * Never import this into client components.
 */
export function createAdminClient() {
  return createServiceRoleClient("PARTS_CANADA_SYNC_MISCONFIGURED");
}

/**
 * Server-only service-role client for Ask OTOMOTO generation and persistence.
 * The distinct error keeps diagnostics configuration failures actionable.
 */
export function createDiagnosticsAdminClient() {
  return createServiceRoleClient("ASK_OTOMOTO_DIAGNOSTICS_MISCONFIGURED");
}
