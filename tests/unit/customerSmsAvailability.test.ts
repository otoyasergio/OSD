import { describe, expect, it } from "vitest";
import {
  canAttemptCustomerSms,
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
