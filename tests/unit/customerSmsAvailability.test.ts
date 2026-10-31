import { describe, expect, it } from "vitest";
import {
  canAttemptCustomerSms,
  deriveCustomerMessageChannel,
  WIX_SMS_LOCAL_OPT_OUT_WARNING,
} from "@/lib/communications/customerSmsAvailability";

describe("customer SMS attempt availability", () => {
  it("allows a valid phone even when the local record says opted out", () => {
    expect(
      canAttemptCustomerSms({
        phone: "(647) 555-0100",
        smsOptedOut: true,
      })
    ).toBe(true);
  });

  it("blocks a missing or invalid phone", () => {
    expect(canAttemptCustomerSms({ phone: null, smsOptedOut: false })).toBe(false);
    expect(canAttemptCustomerSms({ phone: "5551234", smsOptedOut: true })).toBe(false);
  });

  it("directs staff to Wix consent instead of inbound START handling", () => {
    expect(WIX_SMS_LOCAL_OPT_OUT_WARNING).toMatch(/Wix Inbox|Wix Contacts/i);
    expect(WIX_SMS_LOCAL_OPT_OUT_WARNING).not.toMatch(/\bSTART\b/);
  });
});

describe("deriveCustomerMessageChannel", () => {
  it("uses the preferred channel when it is available initially", () => {
    expect(
      deriveCustomerMessageChannel({
        preferredChannel: "sms",
        smsAvailable: true,
        emailAvailable: true,
      })
    ).toBe("sms");
  });

  it("falls back when the preferred channel becomes unavailable after props change", () => {
    expect(
      deriveCustomerMessageChannel({
        preferredChannel: "sms",
        smsAvailable: false,
        emailAvailable: true,
      })
    ).toBe("email");
    expect(
      deriveCustomerMessageChannel({
        preferredChannel: "email",
        smsAvailable: true,
        emailAvailable: false,
      })
    ).toBe("sms");
  });

  it("returns null when neither channel is available", () => {
    expect(
      deriveCustomerMessageChannel({
        preferredChannel: "sms",
        smsAvailable: false,
        emailAvailable: false,
      })
    ).toBeNull();
  });
});
