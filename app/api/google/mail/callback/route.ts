import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCurrentAppUser } from "@/lib/auth/session";
import {
  GMAIL_OAUTH_STATE_COOKIE,
  getGmailOAuthConfig,
  gmailRedirectUri,
  isGmailOAuthConfigured,
} from "@/lib/email/config";
import { exchangeGmailAuthorizationCode } from "@/lib/email/gmail";
import { isCustomerEmailLocation, saveShopMailbox } from "@/lib/email/mailbox";
import { canConnectShopMailbox } from "@/lib/permissions";

export const runtime = "nodejs";

function originFrom(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  return new URL(request.url).origin;
}

function statesMatch(expected: string, received: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export async function GET(request: Request) {
  const origin = originFrom(request);
  const settings = new URL("/settings/email", origin);
  const url = new URL(request.url);
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(GMAIL_OAUTH_STATE_COOKIE)?.value ?? "";
  cookieStore.set(GMAIL_OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/google/mail",
    maxAge: 0,
  });

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
  if (url.searchParams.get("error")) {
    settings.searchParams.set("error", "denied");
    return NextResponse.redirect(settings);
  }

  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  if (!code || !statesMatch(expectedState, state)) {
    settings.searchParams.set("error", "state");
    return NextResponse.redirect(settings);
  }

  try {
    if (!(await isCustomerEmailLocation(user.active_location_id))) {
      settings.searchParams.set("error", "location");
      return NextResponse.redirect(settings);
    }
    const config = getGmailOAuthConfig();
    const connected = await exchangeGmailAuthorizationCode({
      code,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: gmailRedirectUri(origin),
    });
    await saveShopMailbox({
      locationId: user.active_location_id,
      emailAddress: connected.emailAddress,
      refreshToken: connected.refreshToken,
      userId: user.user_id,
    });
  } catch {
    settings.searchParams.set("error", "exchange");
    return NextResponse.redirect(settings);
  }

  settings.searchParams.set("connected", "1");
  return NextResponse.redirect(settings);
}
