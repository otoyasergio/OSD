import { NextResponse } from "next/server";
import { reconcileWixContactsToApp } from "@/lib/services/wixContacts";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Hourly Wix Contacts → app customer reconciliation.
 * Protect with CRON_SECRET (Authorization: Bearer <secret> or ?secret=).
 */
async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization");
  const url = new URL(request.url);
  const querySecret = url.searchParams.get("secret");
  const bearerOk = authHeader === `Bearer ${secret}`;
  const queryOk = querySecret === secret;

  if (!bearerOk && !queryOk) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await reconcileWixContactsToApp({ triggeredBy: "cron" });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "WIX_CONTACTS_SYNC_FAILED";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
