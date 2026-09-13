import { NextResponse } from "next/server";
import { isWithinWixContactsSyncWindow } from "@/lib/datetime/format";
import { reconcileWixContactsToApp } from "@/lib/services/wixContacts";
import { logger, newRequestId } from "@/lib/security/logger";
import { captureException } from "@/lib/security/sentry";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Wix Contacts → app customer reconciliation every 4 minutes (Vercel cron),
 * active 10:00–23:00 America/Toronto only. Overnight invocations no-op.
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

  if (!isWithinWixContactsSyncWindow()) {
    logger.info("Wix contacts cron skipped outside shop window", { requestId });
    return NextResponse.json({ ok: true, skipped: "outside_window" });
  }

  try {
    const result = await reconcileWixContactsToApp({ triggeredBy: "cron" });
    if (result.skipped_reason === "already_running") {
      logger.info("Wix contacts cron skipped prior run still active", { requestId });
      return NextResponse.json({ ok: true, skipped: "already_running" });
    }
    logger.info("Wix contacts cron sync complete", {
      requestId,
      scanned: result.scanned,
      created: result.created,
      updated: result.updated,
      unchanged: result.unchanged,
      skipped: result.skipped,
      failed: result.failed,
      pushed: result.pushed,
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
