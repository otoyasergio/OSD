import { describe, expect, it } from "vitest";
import { createHmac } from "crypto";
import {
  verifySquareWebhookSignature,
  verifyTwilioWebhookSignature,
} from "@/lib/security/webhooks";
import { rateLimit } from "@/lib/security/rateLimit";

describe("verifySquareWebhookSignature", () => {
  it("accepts a valid HMAC signature", () => {
    const notificationUrl = "https://example.com/api/square/webhooks";
    const rawBody = '{"type":"invoice.payment_made"}';
    const signatureKey = "test-signature-key";
    const signature = createHmac("sha256", signatureKey)
      .update(notificationUrl + rawBody)
      .digest("base64");

    expect(
      verifySquareWebhookSignature({
        rawBody,
        signatureHeader: signature,
        signatureKey,
        notificationUrl,
      })
    ).toBe(true);
  });

  it("rejects an invalid signature", () => {
    expect(
      verifySquareWebhookSignature({
        rawBody: "{}",
        signatureHeader: "bad",
        signatureKey: "key",
        notificationUrl: "https://example.com/hook",
      })
    ).toBe(false);
  });

  it("rejects missing signature header", () => {
    expect(
      verifySquareWebhookSignature({
        rawBody: "{}",
        signatureHeader: null,
        signatureKey: "key",
        notificationUrl: "https://example.com/hook",
      })
    ).toBe(false);
  });
});

describe("verifyTwilioWebhookSignature", () => {
  it("accepts a valid Twilio signature", () => {
    const url = "https://example.com/api/twilio/webhooks";
    const params = { From: "+15551234567", Body: "YES" };
    const authToken = "twilio-auth-token";
    const data = url + "BodyYES" + "From+15551234567";
    const signature = createHmac("sha1", authToken).update(data).digest("base64");

    expect(
      verifyTwilioWebhookSignature({
        url,
        params,
        signatureHeader: signature,
        authToken,
      })
    ).toBe(true);
  });

  it("rejects forged Twilio signatures", () => {
    expect(
      verifyTwilioWebhookSignature({
        url: "https://example.com/api/twilio/webhooks",
        params: { From: "+1", Body: "YES" },
        signatureHeader: "forged",
        authToken: "token",
      })
    ).toBe(false);
  });
});

describe("rateLimit", () => {
  it("allows requests under the limit and blocks after", () => {
    const key = `test-${Date.now()}-${Math.random()}`;
    expect(rateLimit({ key, limit: 2, windowMs: 60_000 }).success).toBe(true);
    expect(rateLimit({ key, limit: 2, windowMs: 60_000 }).success).toBe(true);
    expect(rateLimit({ key, limit: 2, windowMs: 60_000 }).success).toBe(false);
  });
});
