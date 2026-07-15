import { NextResponse } from "next/server";
import { processWixBookingWebhook } from "@/lib/services/bookings";
import { clientIp, rateLimit } from "@/lib/security/rateLimit";
import { logger, newRequestId } from "@/lib/security/logger";
import { captureException } from "@/lib/security/sentry";

export const runtime = "nodejs";

/**
 * Wix Bookings webhook → create scheduled work order stub.
 * Requires WIX_WEBHOOK_SECRET (Authorization: Bearer). Fail-closed if missing.
 */
export async function POST(request: Request) {
  const requestId = newRequestId();
  const ip = clientIp(request);
  const limited = rateLimit({
    key: `wix-webhook:${ip}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!limited.success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const secret = process.env.WIX_WEBHOOK_SECRET?.trim();
  if (!secret) {
    logger.error("Wix webhook secret missing — fail closed", { requestId });
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 503 });
  }

  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    logger.warn("Wix webhook unauthorized", { requestId, ip });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const locationId = process.env.WIX_DEFAULT_LOCATION_ID;
  if (!locationId) {
    return NextResponse.json(
      { error: "WIX_DEFAULT_LOCATION_ID is not configured" },
      { status: 500 }
    );
  }

  try {
    const payload = (await request.json()) as {
      bookingId?: string;
      data?: { bookingId?: string };
    };
    const bookingId = payload.bookingId ?? payload.data?.bookingId;
    if (!bookingId) {
      return NextResponse.json({ error: "bookingId required" }, { status: 400 });
    }

    const result = await processWixBookingWebhook({
      bookingId,
      locationId,
    });

    logger.info("Wix booking webhook processed", { requestId, bookingId });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    captureException(error, { requestId, route: "wix-webhook" });
    logger.error("Wix webhook failed", {
      requestId,
      error: error instanceof Error ? error.message : "WEBHOOK_FAILED",
    });
    return NextResponse.json({ ok: false, error: "WEBHOOK_FAILED" }, { status: 500 });
  }
}
