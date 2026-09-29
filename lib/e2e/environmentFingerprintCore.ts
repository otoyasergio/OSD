import { createHash } from "node:crypto";

export const E2E_ENV_GUARD_HEADER = "x-e2e-env-guard-secret";

function canonicalSupabaseTarget(rawUrl: string): string {
  const parsed = new URL(rawUrl.trim());
  const path = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}${path}`;
}

/** One-way identifier used only to prove two configurations target the same DB. */
export function fingerprintSupabaseTarget(rawUrl: string): string {
  return createHash("sha256").update(canonicalSupabaseTarget(rawUrl)).digest("hex");
}
