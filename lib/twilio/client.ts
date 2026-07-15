import { getTwilioConfig, isTwilioConfigured } from "@/lib/twilio/config";
import { normalizePhoneE164 } from "@/lib/twilio/phone";

function statusCallbackUrl(): string | null {
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (!base) return null;
  return `${base}/api/twilio/status`;
}

export async function sendSms(input: {
  to: string;
  body: string;
}): Promise<{ sid: string }> {
  if (!isTwilioConfigured()) throw new Error("TWILIO_NOT_CONFIGURED");

  const to = normalizePhoneE164(input.to);
  if (!to) throw new Error("INVALID_PHONE");

  const config = getTwilioConfig();
  const params = new URLSearchParams({
    To: to,
    Body: input.body,
  });

  // Prefer Messaging Service (A2P campaign pool); fall back to a fixed From number.
  if (config.messagingServiceSid) {
    params.set("MessagingServiceSid", config.messagingServiceSid);
  } else {
    params.set("From", config.fromNumber);
  }

  const callback = statusCallbackUrl();
  if (callback) {
    params.set("StatusCallback", callback);
    params.set("StatusCallbackMethod", "POST");
  }

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    }
  );

  const data = (await response.json()) as { sid?: string; message?: string };
  if (!response.ok) {
    throw new Error(`TWILIO_SEND_FAILED: ${data.message ?? response.statusText}`);
  }

  return { sid: data.sid ?? "" };
}

export { isTwilioConfigured };
