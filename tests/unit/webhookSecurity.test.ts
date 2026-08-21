import { describe, expect, it } from "vitest";
import { createHmac } from "crypto";
import {
  verifySquareWebhookSignature,
  verifyTwilioWebhookSignature,
} from "@/lib/security/webhooks";
import { rateLimit } from "@/lib/security/rateLimit";
import {
  buildLegacyPaymentStatusUpdates,
  shouldSkipIntegrationEvent,
  squareInvoiceTransactionId,
  v2PaymentStatusForMapped,
} from "@/lib/square/webhookDecisions";

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

describe("integration event dedupe", () => {
  it("replays of processed events return early", () => {
    expect(shouldSkipIntegrationEvent("processed")).toBe(true);
    expect(shouldSkipIntegrationEvent("ignored")).toBe(true);
  });

  it("failed and in-flight events stay retryable", () => {
    expect(shouldSkipIntegrationEvent("failed")).toBe(false);
    expect(shouldSkipIntegrationEvent("processing")).toBe(false);
    expect(shouldSkipIntegrationEvent("received")).toBe(false);
    expect(shouldSkipIntegrationEvent(null)).toBe(false);
    expect(shouldSkipIntegrationEvent(undefined)).toBe(false);
  });
});

describe("buildLegacyPaymentStatusUpdates", () => {
  it("collects once on the first paid event", () => {
    const result = buildLegacyPaymentStatusUpdates({
      mapped: "paid",
      previousStatus: "unpaid",
      previousCollectedCents: 0,
      paidAmountCents: 12_500,
      billingAmountCents: 12_500,
      isDeposit: false,
    });
    expect(result.duplicate).toBe(false);
    expect(result.updates).toMatchObject({
      square_payment_status: "paid",
      billing_collected_cents: 12_500,
      billing_stage: "paid",
    });
  });

  it("duplicate paid events never collect twice", () => {
    const replay = buildLegacyPaymentStatusUpdates({
      mapped: "paid",
      previousStatus: "paid",
      previousCollectedCents: 12_500,
      paidAmountCents: 12_500,
      billingAmountCents: 12_500,
      isDeposit: false,
    });
    expect(replay.duplicate).toBe(true);
    expect(replay.updates).toEqual({});
  });

  it("a paid deposit accumulates on prior collections and readies the balance", () => {
    const result = buildLegacyPaymentStatusUpdates({
      mapped: "paid",
      previousStatus: "unpaid",
      previousCollectedCents: 5_000,
      paidAmountCents: null,
      billingAmountCents: 7_500,
      isDeposit: true,
    });
    expect(result.updates).toMatchObject({
      billing_collected_cents: 12_500,
      billing_stage: "ready_to_invoice",
    });
  });

  it("refunds mark the status but never increase collections", () => {
    const result = buildLegacyPaymentStatusUpdates({
      mapped: "refunded",
      previousStatus: "paid",
      previousCollectedCents: 12_500,
      paidAmountCents: 12_500,
      billingAmountCents: 12_500,
      isDeposit: false,
    });
    expect(result.duplicate).toBe(false);
    expect(result.updates).toEqual({ square_payment_status: "refunded" });
    expect("billing_collected_cents" in result.updates).toBe(false);
  });

  it("partial payments track Square's completed total without stacking", () => {
    const result = buildLegacyPaymentStatusUpdates({
      mapped: "partially_paid",
      previousStatus: "partially_paid",
      previousCollectedCents: 4_000,
      paidAmountCents: 6_000,
      billingAmountCents: 10_000,
      isDeposit: false,
    });
    expect(result.updates).toMatchObject({
      billing_collected_cents: 6_000,
      billing_stage: "invoiced",
    });
  });
});

describe("v2 payment event mapping", () => {
  it("ledgers terminal paid and refunded events with deterministic ids", () => {
    expect(v2PaymentStatusForMapped("paid")).toBe("succeeded");
    expect(v2PaymentStatusForMapped("refunded")).toBe("refunded");
    expect(v2PaymentStatusForMapped("partially_paid")).toBeNull();
    expect(v2PaymentStatusForMapped("cancelled")).toBeNull();
    expect(squareInvoiceTransactionId("inv-1", "paid")).toBe(
      squareInvoiceTransactionId("inv-1", "paid")
    );
    expect(squareInvoiceTransactionId("inv-1", "paid")).not.toBe(
      squareInvoiceTransactionId("inv-1", "refunded")
    );
  });
});
