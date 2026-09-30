import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { canUseMessenger } from "@/lib/permissions";
import { createVoiceAccessToken } from "@/lib/twilio/voiceToken";
import { isTwilioVoiceConfigured } from "@/lib/twilio/voiceConfig";

export async function POST() {
  try {
    const user = await requireUser();
    if (!canUseMessenger(user.role)) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
    if (!isTwilioVoiceConfigured()) {
      return NextResponse.json({ error: "TWILIO_VOICE_NOT_CONFIGURED" }, { status: 503 });
    }
    const payload = createVoiceAccessToken(user.user_id);
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNAUTHORIZED";
    const status = message === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
