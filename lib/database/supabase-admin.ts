import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client for privileged server jobs (Parts Canada catalog sync).
 * Never import this into client components.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("PARTS_CANADA_SYNC_MISCONFIGURED");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
