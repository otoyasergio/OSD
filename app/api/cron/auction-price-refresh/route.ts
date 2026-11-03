import { NextResponse } from "next/server";
import { refreshAuctionGuidesDaily } from "@/lib/services/auctionPriceRefresh";
import { logger, newRequestId } from "@/lib/security/logger";
import { captureException } from "@/lib/security/sentry";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Daily auction price refresh.
 * Vercel cron is UTC. 11:15 UTC is 6:15 a.m. Eastern Standard Time and
 * 7:15 a.m. Eastern Daylight Time, before the Toronto shop opens at noon.
 * Runs every day. There is no shop-hours window.
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
    logger.warn("Auction price refresh cron unauthorized", { requestId });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await refreshAuctionGuidesDaily();
    logger.info("Auction price refresh cron finished", {
      requestId,
      motorcycles: result.motorcycles,
      groups: result.groups,
      providerFetches: result.providerFetches,
      providerFailures: result.providerFailures,
      lotsUpserted: result.lotsUpserted,
      snapshotsRebuilt: result.snapshotsRebuilt,
      skipped: result.skipped,
      failed: result.failed,
      remaining: result.remaining,
      truncated: result.truncated,
    });
    return NextResponse.json(result);
  } catch (error) {
    captureException(error, { requestId, route: "auction-price-refresh" });
    logger.error("Auction price refresh cron failed", {
      requestId,
      error: "AUCTION_PRICE_REFRESH_FAILED",
    });
    return NextResponse.json(
      { ok: false, error: "AUCTION_PRICE_REFRESH_FAILED" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  return GET(request);
}
