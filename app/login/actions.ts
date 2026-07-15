"use server";

import { headers } from "next/headers";
import { rateLimit } from "@/lib/security/rateLimit";

/**
 * Call before attempting sign-in. Limits brute-force against the login form.
 */
export async function assertLoginAllowed(): Promise<{ error: string | null }> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";

  const result = rateLimit({
    key: `login:${ip}`,
    limit: 10,
    windowMs: 15 * 60_000,
  });

  if (!result.success) {
    return {
      error: "Too many sign-in attempts. Please wait a few minutes and try again.",
    };
  }

  return { error: null };
}
