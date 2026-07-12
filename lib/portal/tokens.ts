import { createHash, randomBytes } from "crypto";

const TOKEN_BYTES = 32;

export function generatePortalToken(): { token: string; hash: string } {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const hash = hashPortalToken(token);
  return { token, hash };
}

export function hashPortalToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function portalUrl(token: string, baseUrl?: string): string {
  const base =
    baseUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/c/${token}`;
}
