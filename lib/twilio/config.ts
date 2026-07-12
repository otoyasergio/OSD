export function getTwilioConfig(): {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  webhookAuthToken: string;
} {
  const accountSid = process.env.TWILIO_ACCOUNT_SID ?? "";
  const authToken = process.env.TWILIO_AUTH_TOKEN ?? "";
  const fromNumber = process.env.TWILIO_FROM_NUMBER ?? "";
  const webhookAuthToken = process.env.TWILIO_AUTH_TOKEN ?? "";

  if (!accountSid || !authToken || !fromNumber) {
    throw new Error("TWILIO_NOT_CONFIGURED");
  }

  return { accountSid, authToken, fromNumber, webhookAuthToken };
}

export function isTwilioConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID?.trim() &&
      process.env.TWILIO_AUTH_TOKEN?.trim() &&
      process.env.TWILIO_FROM_NUMBER?.trim()
  );
}
