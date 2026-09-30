import { NextResponse } from "next/server";
import {
  getPublicRequestUrl,
  verifyTwilioWebhookSignature,
} from "@/lib/security/webhooks";
import { clientIp, rateLimit } from "@/lib/security/rateLimit";

export async function parseTwilioVoiceWebhook(
  request: Request
): Promise<
  { ok: true; params: Record<string, string> } | { ok: false; response: NextResponse }
> {
  const ip = clientIp(request);
  const limited = rateLimit({
    key: `twilio-voice:${ip}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!limited.success) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Too many requests" }, { status: 429 }),
    };
  }

  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim() ?? "";
  if (!authToken) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Twilio is not configured" }, { status: 503 }),
    };
  }

  const form = await request.formData();
  const params: Record<string, string> = {};
  form.forEach((value, key) => {
    params[key] = String(value);
  });

  const valid = verifyTwilioWebhookSignature({
    url: getPublicRequestUrl(request),
    params,
    signatureHeader: request.headers.get("x-twilio-signature"),
    authToken,
  });
  if (!valid) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid signature" }, { status: 401 }),
    };
  }

  return { ok: true, params };
}

export function twimlResponse(xml: string): NextResponse {
  return new NextResponse(xml, {
    headers: { "Content-Type": "text/xml" },
  });
}
