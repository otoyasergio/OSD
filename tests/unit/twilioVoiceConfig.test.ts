import { describe, expect, it } from "vitest";
import { isTwilioVoiceConfigured } from "@/lib/twilio/voiceConfig";

describe("isTwilioVoiceConfigured", () => {
  it("requires account, API key pair, and TwiML app SID", () => {
    const previous = {
      TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
      TWILIO_API_KEY_SID: process.env.TWILIO_API_KEY_SID,
      TWILIO_API_KEY_SECRET: process.env.TWILIO_API_KEY_SECRET,
      TWILIO_TWIML_APP_SID: process.env.TWILIO_TWIML_APP_SID,
    };
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_API_KEY_SID;
    delete process.env.TWILIO_API_KEY_SECRET;
    delete process.env.TWILIO_TWIML_APP_SID;
    expect(isTwilioVoiceConfigured()).toBe(false);

    process.env.TWILIO_ACCOUNT_SID = "ACxxx";
    process.env.TWILIO_API_KEY_SID = "SKxxx";
    process.env.TWILIO_API_KEY_SECRET = "secret";
    expect(isTwilioVoiceConfigured()).toBe(false);

    process.env.TWILIO_TWIML_APP_SID = "APxxx";
    expect(isTwilioVoiceConfigured()).toBe(true);

    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
});
