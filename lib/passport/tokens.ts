import { createHash, randomBytes } from "node:crypto";

const TOKEN_BYTES = 32;
const DEFAULT_GRANT_DAYS = 7;

export function hashPassportShareToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generatePassportShareToken(): {
  token: string;
  hash: string;
} {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return { token, hash: hashPassportShareToken(token) };
}

export function passportShareExpiry(now = new Date()): string {
  const expiry = new Date(now);
  expiry.setUTCDate(expiry.getUTCDate() + DEFAULT_GRANT_DAYS);
  return expiry.toISOString();
}

export function passportShareUrl(token: string, baseUrl?: string): string {
  const base = baseUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/p/${token}`;
}

export type PassportShareStatus = "active" | "expired" | "revoked";

export function passportShareStatus(
  share: { expires_at: string; revoked_at: string | null },
  now = new Date()
): PassportShareStatus {
  if (share.revoked_at) return "revoked";
  if (new Date(share.expires_at).getTime() <= now.getTime()) return "expired";
  return "active";
}
