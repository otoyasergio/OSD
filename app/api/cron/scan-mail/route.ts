import { NextResponse } from "next/server";
import { ingestScanMail } from "@/lib/services/scanMailIntake";
import { logger, newRequestId } from "@/lib/security/logger";
import { captureException } from "@/lib/security/sentry";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Reads unread TopGuru reports from the diagnostics mailbox and files each one
 * on the open inspection with the same VIN.
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
    logger.warn("Scan mail cron unauthorized", { requestId });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await ingestScanMail();
    logger.info("Scan mail cron finished", { requestId, ...result });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    captureException(error, { requestId, route: "scan-mail" });
    const code = error instanceof Error ? error.message : "SCAN_MAIL_FAILED";
    logger.error("Scan mail cron failed", { requestId, error: code });
    return NextResponse.json({ ok: false, error: "SCAN_MAIL_FAILED" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return GET(request);
}
