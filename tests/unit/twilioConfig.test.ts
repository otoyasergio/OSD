import { afterEach, describe, expect, it, vi } from "vitest";
import { getTwilioConfig, isTwilioConfigured } from "@/lib/twilio/config";
import { sendSms } from "@/lib/twilio/client";

const ENV_KEYS = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_FROM_NUMBER",
  "TWILIO_MESSAGING_SERVICE_SID",
] as const;

function clearTwilioEnv() {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
}

afterEach(() => {
  clearTwilioEnv();
  delete process.env.NEXT_PUBLIC_APP_URL;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("isTwilioConfigured", () => {
  it("is false when nothing is set", () => {
    clearTwilioEnv();
    expect(isTwilioConfigured()).toBe(false);
  });

  it("is true with account, token, and From number", () => {
    process.env.TWILIO_ACCOUNT_SID = "ACxxx";
    process.env.TWILIO_AUTH_TOKEN = "token";
    process.env.TWILIO_FROM_NUMBER = "+14165551234";
    expect(isTwilioConfigured()).toBe(true);
  });

  it("is true with account, token, and Messaging Service SID (no From)", () => {
    process.env.TWILIO_ACCOUNT_SID = "ACxxx";
    process.env.TWILIO_AUTH_TOKEN = "token";
    process.env.TWILIO_MESSAGING_SERVICE_SID = "MGxxx";
    expect(isTwilioConfigured()).toBe(true);
  });

  it("is false when only account and token are set", () => {
    process.env.TWILIO_ACCOUNT_SID = "ACxxx";
    process.env.TWILIO_AUTH_TOKEN = "token";
    expect(isTwilioConfigured()).toBe(false);
  });
});

describe("getTwilioConfig", () => {
  it("throws when neither Messaging Service nor From is set", () => {
    process.env.TWILIO_ACCOUNT_SID = "ACxxx";
    process.env.TWILIO_AUTH_TOKEN = "token";
    expect(() => getTwilioConfig()).toThrow("TWILIO_NOT_CONFIGURED");
  });

  it("returns messagingServiceSid when set", () => {
    process.env.TWILIO_ACCOUNT_SID = "ACxxx";
    process.env.TWILIO_AUTH_TOKEN = "token";
    process.env.TWILIO_MESSAGING_SERVICE_SID = "MGxxx";
    const config = getTwilioConfig();
    expect(config.messagingServiceSid).toBe("MGxxx");
    expect(config.fromNumber).toBe("");
  });
});

describe("sendSms", () => {
  it("sends with MessagingServiceSid when configured", async () => {
    process.env.TWILIO_ACCOUNT_SID = "ACxxx";
    process.env.TWILIO_AUTH_TOKEN = "token";
    process.env.TWILIO_MESSAGING_SERVICE_SID = "MGxxx";
    process.env.TWILIO_FROM_NUMBER = "+14165551234";
    process.env.NEXT_PUBLIC_APP_URL = "https://service.torontomoto.com";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sid: "SMxxx" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await sendSms({ to: "+14165559876", body: "Hello" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const body = String(fetchMock.mock.calls[0][1].body);
    expect(body).toContain("MessagingServiceSid=MGxxx");
    expect(body).not.toContain("From=");
    expect(body).toContain("To=%2B14165559876");
    expect(body).toContain(
      "StatusCallback=" +
        encodeURIComponent("https://service.torontomoto.com/api/twilio/status")
    );
  });

  it("sends with From when Messaging Service is not set", async () => {
    process.env.TWILIO_ACCOUNT_SID = "ACxxx";
    process.env.TWILIO_AUTH_TOKEN = "token";
    process.env.TWILIO_FROM_NUMBER = "+14165551234";
    delete process.env.NEXT_PUBLIC_APP_URL;

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sid: "SMyyy" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendSms({ to: "4165559876", body: "Hello" });

    expect(result.sid).toBe("SMyyy");
    const body = String(fetchMock.mock.calls[0][1].body);
    expect(body).toContain("From=%2B14165551234");
    expect(body).toContain("To=%2B14165559876");
    expect(body).not.toContain("MessagingServiceSid=");
  });

  it("rejects invalid phone numbers", async () => {
    process.env.TWILIO_ACCOUNT_SID = "ACxxx";
    process.env.TWILIO_AUTH_TOKEN = "token";
    process.env.TWILIO_FROM_NUMBER = "+14165551234";
    await expect(sendSms({ to: "123", body: "Hi" })).rejects.toThrow("INVALID_PHONE");
  });
});
