import { NextResponse } from "next/server";
import { processSquareWebhookEvent } from "@/lib/services/squareBilling";
import { isSquareConfigured } from "@/lib/square/config";
import {
  getPublicRequestUrl,
  verifySquareWebhookSignature,
} from "@/lib/security/webhooks";
import { clientIp, rateLimit } from "@/lib/security/rateLimit";
import { logger, newRequestId } from "@/lib/security/logger";
import { captureException } from "@/lib/security/sentry";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = newRequestId();
  const ip = clientIp(request);
  const limited = rateLimit({
    key: `square-webhook:${ip}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!limited.success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  if (!isSquareConfigured()) {
    return NextResponse.json({ error: "Square is not configured" }, { status: 503 });
  }

  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY?.trim() ?? "";
  if (!signatureKey) {
    logger.error("Square webhook signature key missing", { requestId });
    return NextResponse.json(
      { error: "Webhook signature key not configured" },
      { status: 503 }
    );
  }

  const rawBody = await request.text();
  const signatureHeader = request.headers.get("x-square-hmacsha256-signature");
  const notificationUrl = getPublicRequestUrl(request);

  if (
    !verifySquareWebhookSignature({
      rawBody,
      signatureHeader,
      signatureKey,
      notificationUrl,
    })
  ) {
    logger.warn("Square webhook signature rejected", { requestId, ip });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  try {
    const payload = JSON.parse(rawBody) as {
      type?: string;
      event_id?: string;
      eventId?: string;
      data?: Record<string, unknown>;
    };
    const eventId = payload.event_id ?? payload.eventId ?? crypto.randomUUID();
    await processSquareWebhookEvent({
      type: payload.type ?? "unknown",
      event_id: eventId,
      data: payload.data ?? {},
    });
    logger.info("Square webhook processed", {
      requestId,
      eventId,
      type: payload.type,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    captureException(error, { requestId, route: "square-webhook" });
    logger.error("Square webhook failed", {
      requestId,
      error: error instanceof Error ? error.message : "WEBHOOK_FAILED",
    });
    return NextResponse.json({ ok: false, error: "WEBHOOK_FAILED" }, { status: 500 });
  }
}
