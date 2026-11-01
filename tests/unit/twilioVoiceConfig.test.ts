import { afterEach, describe, expect, it } from "vitest";
import { getTwilioVoiceConfig, isTwilioVoiceConfigured } from "@/lib/twilio/voiceConfig";

const KEYS = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_API_KEY_SID",
  "TWILIO_API_KEY_SECRET",
  "TWILIO_TWIML_APP_SID",
] as const;

afterEach(() => {
  for (const key of KEYS) delete process.env[key];
});

describe("Twilio Voice config", () => {
  it("requires the auth token in addition to account, API key pair, and TwiML App", () => {
    expect(isTwilioVoiceConfigured()).toBe(false);
    process.env.TWILIO_ACCOUNT_SID = "ACxxx";
    process.env.TWILIO_API_KEY_SID = "SKxxx";
    process.env.TWILIO_API_KEY_SECRET = "secret";
    process.env.TWILIO_TWIML_APP_SID = "APxxx";
    expect(isTwilioVoiceConfigured()).toBe(false);
    process.env.TWILIO_AUTH_TOKEN = "auth-token";
    expect(isTwilioVoiceConfigured()).toBe(true);
  });

  it("keeps token-generation config independent of the webhook auth token", () => {
    process.env.TWILIO_ACCOUNT_SID = "ACxxx";
    process.env.TWILIO_API_KEY_SID = "SKxxx";
    process.env.TWILIO_API_KEY_SECRET = "secret";
    process.env.TWILIO_TWIML_APP_SID = "APxxx";

    expect(getTwilioVoiceConfig()).toEqual({
      accountSid: "ACxxx",
      apiKeySid: "SKxxx",
      apiKeySecret: "secret",
      twimlAppSid: "APxxx",
    });
  });

  it("throws when Voice is not configured", () => {
    expect(() => getTwilioVoiceConfig()).toThrow("TWILIO_VOICE_NOT_CONFIGURED");
  });
});
