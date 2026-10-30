import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCurrentAppUser } from "@/lib/auth/session";
import {
  GMAIL_OAUTH_STATE_COOKIE,
  getGmailOAuthConfig,
  gmailRedirectUri,
  isGmailOAuthConfigured,
} from "@/lib/email/config";
import { gmailAuthorizationUrl } from "@/lib/email/gmail";
import { isCustomerEmailLocation } from "@/lib/email/mailbox";
import { canConnectShopMailbox } from "@/lib/permissions";

export const runtime = "nodejs";

function originFrom(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  return new URL(request.url).origin;
}

export async function GET(request: Request) {
  const origin = originFrom(request);
  const settings = new URL("/settings/email", origin);
  const user = await getCurrentAppUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login?next=/settings/email", origin));
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
  cookieStore.set(GMAIL_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/google/mail",
    maxAge: 600,
  });

  const { clientId } = getGmailOAuthConfig();
  const url = gmailAuthorizationUrl({
    clientId,
    redirectUri: gmailRedirectUri(origin),
    state,
  });
  return NextResponse.redirect(url);
}
