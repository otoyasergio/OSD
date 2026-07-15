import { describe, expect, it } from "vitest";
import { normalizePhoneE164 } from "@/lib/twilio/phone";
import { mapTwilioMessageStatus } from "@/lib/twilio/statusMap";

describe("normalizePhoneE164", () => {
  it("normalizes 10-digit NA numbers", () => {
    expect(normalizePhoneE164("(416) 555-1234")).toBe("+14165551234");
  });

  it("keeps valid E.164", () => {
    expect(normalizePhoneE164("+14165551234")).toBe("+14165551234");
  });

  it("rejects short numbers", () => {
    expect(normalizePhoneE164("5551234")).toBeNull();
  });
});

describe("mapTwilioMessageStatus", () => {
  it("maps delivered and undelivered", () => {
    expect(mapTwilioMessageStatus("delivered")).toBe("delivered");
    expect(mapTwilioMessageStatus("undelivered")).toBe("failed");
    expect(mapTwilioMessageStatus("failed")).toBe("failed");
    expect(mapTwilioMessageStatus("queued")).toBe("queued");
    expect(mapTwilioMessageStatus("sent")).toBe("sent");
  });

  it("returns null for unknown", () => {
    expect(mapTwilioMessageStatus("weird")).toBeNull();
  });
});
