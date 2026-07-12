import { getTwilioConfig, isTwilioConfigured } from "@/lib/twilio/config";

export async function sendSms(input: {
  to: string;
  body: string;
}): Promise<{ sid: string }> {
  if (!isTwilioConfigured()) throw new Error("TWILIO_NOT_CONFIGURED");

  const config = getTwilioConfig();
  const params = new URLSearchParams({
    To: input.to,
    From: config.fromNumber,
    Body: input.body,
  });

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
