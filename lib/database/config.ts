export type SupabasePublicConfig = {
  url: string;
  publishableKey: string;
};

/**
 * Prefer Supabase's current publishable key format while keeping the legacy
 * anon key as a temporary compatibility fallback.
 */
export function getSupabasePublicConfig(): SupabasePublicConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !publishableKey) return null;
  return { url, publishableKey };
}

export function requireSupabasePublicConfig(): SupabasePublicConfig {
  const config = getSupabasePublicConfig();
  if (!config) throw new Error("SUPABASE_CONFIG_MISSING");
  return config;
}
