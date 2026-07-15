import { NextResponse } from "next/server";
import { syncPartsCanadaCatalog } from "@/lib/services/partsCanadaCatalog";
import { logger, newRequestId } from "@/lib/security/logger";
import { captureException } from "@/lib/security/sentry";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Daily Parts Canada inventory sync.
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

  try {
    const result = await syncPartsCanadaCatalog({ triggeredBy: "cron" });
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
