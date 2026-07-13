import { NextResponse } from "next/server";
import { handleInboundSms } from "@/lib/services/communications";
import { isTwilioConfigured } from "@/lib/twilio/config";
import {
  getPublicRequestUrl,
  verifyTwilioWebhookSignature,
} from "@/lib/security/webhooks";
import { clientIp, rateLimit } from "@/lib/security/rateLimit";
import { logger, newRequestId } from "@/lib/security/logger";
import { captureException } from "@/lib/security/sentry";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = newRequestId();
  const ip = clientIp(request);
  const limited = rateLimit({
    key: `twilio-webhook:${ip}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!limited.success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  if (!isTwilioConfigured()) {
    return NextResponse.json({ error: "Twilio is not configured" }, { status: 503 });
  }

  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim() ?? "";
  const form = await request.formData();
  const params: Record<string, string> = {};
  form.forEach((value, key) => {
    params[key] = String(value);
  });

  const signatureHeader = request.headers.get("x-twilio-signature");
  const url = getPublicRequestUrl(request);

  if (
    !verifyTwilioWebhookSignature({
      url,
      params,
      signatureHeader,
      authToken,
    })
  ) {
    logger.warn("Twilio webhook signature rejected", { requestId, ip });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const from = params.From ?? "";
  const body = params.Body ?? "";

  if (!from || !body) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    await handleInboundSms({ from, body });
    logger.info("Twilio inbound SMS processed", { requestId });
    return new NextResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      { headers: { "Content-Type": "text/xml" } }
    );
  } catch (error) {
    captureException(error, { requestId, route: "twilio-webhook" });
    logger.error("Twilio webhook failed", {
      requestId,
      error: error instanceof Error ? error.message : "WEBHOOK_FAILED",
    });
    return NextResponse.json({ ok: false, error: "WEBHOOK_FAILED" }, { status: 500 });
  }
}
