import { createBrowserClient } from "@supabase/ssr";
import { requireSupabasePublicConfig } from "@/lib/database/config";

export function createClient() {
  const { url, publishableKey } = requireSupabasePublicConfig();
  return createBrowserClient(url, publishableKey);
}
