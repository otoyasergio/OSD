import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/database/supabase-admin";
import { isTwilioConfigured } from "@/lib/twilio/config";
import { mapTwilioMessageStatus } from "@/lib/twilio/statusMap";
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
    key: `twilio-status:${ip}`,
    limit: 120,
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
    logger.warn("Twilio status signature rejected", { requestId, ip });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const messageSid = params.MessageSid ?? params.SmsSid ?? "";
  const mapped = mapTwilioMessageStatus(params.MessageStatus ?? params.SmsStatus);
  if (!messageSid || !mapped) {
    return new NextResponse(null, { status: 204 });
  }

  try {
    const admin = createAdminClient();
    const patch: {
      status: string;
      error_message?: string | null;
    } = { status: mapped };

    if (mapped === "failed") {
      patch.error_message =
        params.ErrorMessage?.trim() ||
        (params.ErrorCode ? `Twilio error ${params.ErrorCode}` : null);
    }

    const { error } = await admin
      .from("communication_log")
      .update(patch)
      .eq("external_id", messageSid)
      .eq("channel", "sms");

    if (error) throw error;

    logger.info("Twilio status updated", {
      requestId,
      messageSid,
      status: mapped,
    });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    captureException(error, { requestId, route: "twilio-status" });
    logger.error("Twilio status webhook failed", {
      requestId,
      error: error instanceof Error ? error.message : "STATUS_WEBHOOK_FAILED",
    });
    return NextResponse.json(
      { ok: false, error: "STATUS_WEBHOOK_FAILED" },
      { status: 500 }
    );
  }
}
