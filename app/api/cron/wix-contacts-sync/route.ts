import { NextResponse } from "next/server";
import { reconcileWixContactsToApp } from "@/lib/services/wixContacts";
import { logger, newRequestId } from "@/lib/security/logger";
import { captureException } from "@/lib/security/sentry";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Daily Wix Contacts → app customer reconciliation (11:30 America/Toronto → 15:30 UTC).
 * Protect with CRON_SECRET via Authorization: Bearer <secret> only.
 */
export async function GET(request: Request) {
  const requestId = newRequestId();
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    logger.warn("Wix contacts cron unauthorized", { requestId });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await reconcileWixContactsToApp({ triggeredBy: "cron" });
    logger.info("Wix contacts cron sync complete", {
      requestId,
      scanned: result.scanned,
      created: result.created,
      updated: result.updated,
      unchanged: result.unchanged,
      skipped: result.skipped,
      failed: result.failed,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    captureException(error, { requestId, route: "wix-contacts-cron" });
    logger.error("Wix contacts cron sync failed", {
      requestId,
      error: error instanceof Error ? error.message : "WIX_CONTACTS_SYNC_FAILED",
    });
    return NextResponse.json(
      { ok: false, error: "WIX_CONTACTS_SYNC_FAILED" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  return GET(request);
}
