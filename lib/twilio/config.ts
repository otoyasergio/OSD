export function getTwilioConfig(): {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  messagingServiceSid: string;
  webhookAuthToken: string;
} {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim() ?? "";
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim() ?? "";
  const fromNumber = process.env.TWILIO_FROM_NUMBER?.trim() ?? "";
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim() ?? "";
  const webhookAuthToken = authToken;

  if (!accountSid || !authToken || (!messagingServiceSid && !fromNumber)) {
    throw new Error("TWILIO_NOT_CONFIGURED");
  }

  return {
    accountSid,
    authToken,
    fromNumber,
    messagingServiceSid,
    webhookAuthToken,
  };
}

export function isTwilioConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID?.trim() &&
    process.env.TWILIO_AUTH_TOKEN?.trim() &&
    (process.env.TWILIO_MESSAGING_SERVICE_SID?.trim() ||
      process.env.TWILIO_FROM_NUMBER?.trim())
  );
}
