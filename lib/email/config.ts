import { TORONTO_SHOP } from "@/lib/shop/toronto";

/**
 * Google mailbox OAuth for customer email. The refresh token is stored per
 * location after an owner connects the shop mailbox. These two values only
 * identify the OAuth client.
 */
export function customerEmailLocationAllowed(code: string | null | undefined): boolean {
  return code === TORONTO_SHOP.locationCode;
}

export function getGmailOAuthConfig(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GMAIL_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.GMAIL_CLIENT_SECRET?.trim() ?? "";
  if (!clientId || !clientSecret) throw new Error("EMAIL_NOT_CONFIGURED");
  return { clientId, clientSecret };
}

export function isGmailOAuthConfigured(): boolean {
  return Boolean(
    process.env.GMAIL_CLIENT_ID?.trim() && process.env.GMAIL_CLIENT_SECRET?.trim()
  );
}

export function gmailRedirectUri(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/google/mail/callback`;
}

export const GMAIL_OAUTH_STATE_COOKIE = "otomoto_gmail_oauth_state";
