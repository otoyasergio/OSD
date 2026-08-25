export function isTwilioVoiceConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID?.trim() &&
    process.env.TWILIO_API_KEY_SID?.trim() &&
    process.env.TWILIO_API_KEY_SECRET?.trim() &&
    process.env.TWILIO_TWIML_APP_SID?.trim()
  );
}

export function getTwilioVoiceConfig(): {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  twimlAppSid: string;
} {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim() ?? "";
  const apiKeySid = process.env.TWILIO_API_KEY_SID?.trim() ?? "";
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET?.trim() ?? "";
  const twimlAppSid = process.env.TWILIO_TWIML_APP_SID?.trim() ?? "";
  if (!accountSid || !apiKeySid || !apiKeySecret || !twimlAppSid) {
    throw new Error("TWILIO_VOICE_NOT_CONFIGURED");
  }
  return { accountSid, apiKeySid, apiKeySecret, twimlAppSid };
}
