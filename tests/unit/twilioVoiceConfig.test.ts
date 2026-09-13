import { afterEach, describe, expect, it } from "vitest";
import { getTwilioVoiceConfig, isTwilioVoiceConfigured } from "@/lib/twilio/voiceConfig";

const KEYS = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_API_KEY_SID",
  "TWILIO_API_KEY_SECRET",
  "TWILIO_TWIML_APP_SID",
] as const;

afterEach(() => {
  for (const key of KEYS) delete process.env[key];
});

describe("Twilio Voice config", () => {
  it("is false until account, API key pair, and TwiML App SID are set", () => {
    expect(isTwilioVoiceConfigured()).toBe(false);
    process.env.TWILIO_ACCOUNT_SID = "ACxxx";
    process.env.TWILIO_API_KEY_SID = "SKxxx";
    process.env.TWILIO_API_KEY_SECRET = "secret";
    expect(isTwilioVoiceConfigured()).toBe(false);
    process.env.TWILIO_TWIML_APP_SID = "APxxx";
    expect(isTwilioVoiceConfigured()).toBe(true);
  });

  it("throws when Voice is not configured", () => {
    expect(() => getTwilioVoiceConfig()).toThrow("TWILIO_VOICE_NOT_CONFIGURED");
  });
});
