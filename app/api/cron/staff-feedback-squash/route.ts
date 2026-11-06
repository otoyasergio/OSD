import { NextResponse } from "next/server";
import { isStaffFeedbackSquashHour } from "@/lib/datetime/format";
import { repairStaffFeedback, squashStaffFeedback } from "@/lib/services/staffFeedback";
import { logger, newRequestId } from "@/lib/security/logger";
import { captureException } from "@/lib/security/sentry";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Pack open staff screen notes into one zip each night at 11:00 p.m. America/Toronto.
 * Vercel cron is UTC, so this runs at 03:00, 04:00, and 05:00 UTC.
 * Only the slot that lands on 23:00 Toronto packs the day.
 * Every slot rebuilds a missing zip, removes pictures already inside that zip,
 * and deletes uploads that never became a note.
 * 05:00 UTC is midnight in winter, so a failed 11:00 p.m. pack is repaired the same night.
 * Protect with CRON_SECRET via Authorization: Bearer <secret> only.
 */
function statusForRepair(archivesFailed: number | undefined): number {
  return (archivesFailed ?? 0) > 0 ? 500 : 200;
}

export async function GET(request: Request) {
  const requestId = newRequestId();
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    logger.warn("Staff feedback squash cron unauthorized", { requestId });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  try {
    if (!isStaffFeedbackSquashHour(now)) {
      const repair = await repairStaffFeedback(now);
      logger.info("Staff feedback squash cron skipped outside 11 p.m.", {
        requestId,
        repair,
      });
      return NextResponse.json(
        { ok: true, skipped: "outside_window", repair },
        { status: statusForRepair(repair.archivesFailed) }
      );
    }

    const result = await squashStaffFeedback(now);
    logger.info("Staff feedback squash cron finished", { requestId, ...result });
    return NextResponse.json(result, {
      status: statusForRepair(result.repair?.archivesFailed),
    });
  } catch (error) {
    captureException(error, { requestId, route: "staff-feedback-squash" });
    const code = error instanceof Error ? error.message : "STAFF_FEEDBACK_SQUASH_FAILED";
    logger.error("Staff feedback squash cron failed", { requestId, error: code });
    return NextResponse.json(
      {
        ok: false,
        error:
          code === "STAFF_FEEDBACK_MISCONFIGURED"
            ? "STAFF_FEEDBACK_MISCONFIGURED"
            : "STAFF_FEEDBACK_SQUASH_FAILED",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  return GET(request);
}
