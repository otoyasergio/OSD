import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCurrentAppUser } from "@/lib/auth/session";
import {
  GMAIL_OAUTH_PURPOSE_COOKIE,
  GMAIL_OAUTH_STATE_COOKIE,
  getGmailOAuthConfig,
  gmailRedirectUri,
  isGmailOAuthConfigured,
} from "@/lib/email/config";
import { scanGmailAuthorizationUrl } from "@/lib/email/gmail";
import { SCAN_REPORT_ADDRESS } from "@/lib/email/scanReport";
import { isCustomerEmailLocation } from "@/lib/email/mailbox";
import { canConnectShopMailbox } from "@/lib/permissions";

export const runtime = "nodejs";

function originFrom(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  return new URL(request.url).origin;
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/api/google/mail",
    maxAge,
  };
}

export async function GET(request: Request) {
  const origin = originFrom(request);
  const settings = new URL("/settings/scan-mail", origin);
  const user = await getCurrentAppUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login?next=/settings/scan-mail", origin));
  }
  if (!canConnectShopMailbox(user.role) || !user.active_location_id) {
    settings.searchParams.set("error", "forbidden");
    return NextResponse.redirect(settings);
  }
  if (!isGmailOAuthConfigured()) {
    settings.searchParams.set("error", "oauth");
    return NextResponse.redirect(settings);
  }
  try {
    if (!(await isCustomerEmailLocation(user.active_location_id))) {
      settings.searchParams.set("error", "location");
      return NextResponse.redirect(settings);
    }
  } catch {
    settings.searchParams.set("error", "exchange");
    return NextResponse.redirect(settings);
  }

  const state = randomBytes(32).toString("hex");
  const cookieStore = await cookies();
  cookieStore.set(GMAIL_OAUTH_STATE_COOKIE, state, cookieOptions(600));
  cookieStore.set(GMAIL_OAUTH_PURPOSE_COOKIE, "scan", cookieOptions(600));

  const { clientId } = getGmailOAuthConfig();
  const url = scanGmailAuthorizationUrl({
    clientId,
    redirectUri: gmailRedirectUri(origin),
    state,
    loginHint: SCAN_REPORT_ADDRESS,
  });
  return NextResponse.redirect(url);
}
