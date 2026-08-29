import { NextResponse } from "next/server";
import { captureException } from "@/lib/security/sentry";
import { logger, newRequestId } from "@/lib/security/logger";
import { applyVoiceCallStatus } from "@/lib/services/shopPhone";
import { parseTwilioVoiceWebhook } from "@/lib/twilio/voiceWebhook";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = newRequestId();
  const parsed = await parseTwilioVoiceWebhook(request);
  if (!parsed.ok) return parsed.response;

  try {
    await applyVoiceCallStatus(parsed.params);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    captureException(error, { requestId, route: "twilio-voice-status" });
    logger.error("Twilio voice status failed", {
      requestId,
      error: error instanceof Error ? error.message : "VOICE_STATUS_FAILED",
    });
    return NextResponse.json(
      { ok: false, error: "VOICE_STATUS_FAILED" },
      { status: 500 }
    );
  }
}
