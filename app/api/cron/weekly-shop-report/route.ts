import { NextResponse } from "next/server";
import { isFridayShopReportHour } from "@/lib/datetime/format";
import { sendWeeklyShopReport } from "@/lib/services/weeklyShopReport";
import { logger, newRequestId } from "@/lib/security/logger";
import { captureException } from "@/lib/security/sentry";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Friday 8:00 p.m. America/Toronto shop report.
 * Vercel cron is UTC, so this runs at Saturday 00:00 and 01:00 UTC.
 * Only the slot that lands on Friday 20:00 Toronto sends.
 * Protect with CRON_SECRET via Authorization: Bearer <secret> only.
 */
export async function GET(request: Request) {
  return handleWeeklyShopReportCron(request, new Date());
}

export async function POST(request: Request) {
  return GET(request);
}

export async function handleWeeklyShopReportCron(request: Request, now: Date) {
  const requestId = newRequestId();
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    logger.warn("Weekly shop report cron unauthorized", { requestId });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isFridayShopReportHour(now)) {
    logger.info("Weekly shop report cron skipped outside Friday 8 p.m.", { requestId });
    return NextResponse.json({ ok: true, skipped: "outside_window" });
  }

  try {
    const result = await sendWeeklyShopReport(now);
    logger.info("Weekly shop report cron finished", { requestId, ...result });
    return NextResponse.json(result);
  } catch (error) {
    captureException(error, { requestId, route: "weekly-shop-report" });
    const code = error instanceof Error ? error.message : "WEEKLY_SHOP_REPORT_FAILED";
    logger.error("Weekly shop report cron failed", { requestId, error: code });
    return NextResponse.json(
      {
        ok: false,
        error:
          code === "EMAIL_NOT_CONFIGURED"
            ? "EMAIL_NOT_CONFIGURED"
            : "WEEKLY_SHOP_REPORT_FAILED",
      },
      { status: 500 }
    );
  }
}
