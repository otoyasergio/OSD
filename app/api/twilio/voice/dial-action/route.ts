import { captureException } from "@/lib/security/sentry";
import { logger, newRequestId } from "@/lib/security/logger";
import { handleDialAction } from "@/lib/services/shopPhone";
import { parseTwilioVoiceWebhook, twimlResponse } from "@/lib/twilio/voiceWebhook";
import { missedCallTwiml } from "@/lib/twilio/voiceTwiml";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = newRequestId();
  const parsed = await parseTwilioVoiceWebhook(request);
  if (!parsed.ok) return parsed.response;

  try {
    const xml = await handleDialAction(parsed.params);
    return twimlResponse(xml);
  } catch (error) {
    captureException(error, { requestId, route: "twilio-voice-dial-action" });
    logger.error("Twilio dial action failed", {
      requestId,
      error: error instanceof Error ? error.message : "VOICE_DIAL_ACTION_FAILED",
    });
    return twimlResponse(missedCallTwiml());
  }
}
