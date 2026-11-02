import { NextResponse } from "next/server";
import { isStorageNoticeHour } from "@/lib/storage/notice";
import { sendStorageMonthNotices } from "@/lib/services/storageNotice";
import { logger, newRequestId } from "@/lib/security/logger";
import { captureException } from "@/lib/security/sentry";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Morning storage notice. Vercel cron is 15:00 UTC, which is 10:00 Toronto
 * in winter and 11:00 Toronto in summer. Sunday is skipped here; shop-closure
 * dates are skipped inside the sender.
 */
export async function GET(request: Request) {
  const requestId = newRequestId();
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    logger.warn("Storage notice cron unauthorized", { requestId });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  if (!isStorageNoticeHour(now)) {
    logger.info("Storage notice cron skipped outside the morning window", { requestId });
    return NextResponse.json({ ok: true, skipped: "outside_window" });
  }

  try {
    const result = await sendStorageMonthNotices(now);
    logger.info("Storage notice cron finished", { requestId, ...result });
    return NextResponse.json(result);
  } catch (error) {
    captureException(error, { requestId, route: "storage-notice" });
    const code = error instanceof Error ? error.message : "STORAGE_NOTICE_FAILED";
    logger.error("Storage notice cron failed", { requestId, error: code });
    return NextResponse.json({ ok: false, error: "STORAGE_NOTICE_FAILED" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return GET(request);
}
