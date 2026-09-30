import { NextResponse } from "next/server";
import { isWithinShopCronWindow } from "@/lib/datetime/format";
import { syncPartsCanadaCatalog } from "@/lib/services/partsCanadaCatalog";
import { logger, newRequestId } from "@/lib/security/logger";
import { captureException } from "@/lib/security/sentry";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Parts Canada inventory sync every 4 hours (Vercel cron),
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
    logger.warn("Cron unauthorized", { requestId });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isWithinShopCronWindow()) {
    logger.info("Parts Canada cron skipped outside shop window", { requestId });
    return NextResponse.json({ ok: true, skipped: "outside_window" });
  }

  try {
    const result = await syncPartsCanadaCatalog({ triggeredBy: "cron" });
    if (result.skipped_reason === "already_running") {
      logger.info("Parts Canada cron skipped prior run still active", { requestId });
      return NextResponse.json({ ok: true, skipped: "already_running" });
    }
    logger.info("Parts Canada cron sync complete", {
      requestId,
      row_count: result.row_count,
    });
    return NextResponse.json({ ok: true, row_count: result.row_count });
  } catch (error) {
    captureException(error, { requestId, route: "parts-canada-cron" });
    logger.error("Parts Canada cron sync failed", {
      requestId,
      error: error instanceof Error ? error.message : "PARTS_CANADA_SYNC_FAILED",
    });
    return NextResponse.json(
      { ok: false, error: "PARTS_CANADA_SYNC_FAILED" },
      { status: 500 }
    );
  }
}
