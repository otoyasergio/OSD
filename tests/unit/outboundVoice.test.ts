import { describe, expect, it } from "vitest";
import { authorizeOutboundVoice } from "@/lib/twilio/outboundVoice";

describe("authorizeOutboundVoice", () => {
  it("allows front office to call a customer when the shop has a caller ID", () => {
    expect(
      authorizeOutboundVoice("service_advisor", {
        type: "pstn",
        toE164: "+14165551234",
        callerId: "+14165550000",
      })
    ).toEqual({ ok: true });
  });

  it("rejects PSTN for technicians", () => {
    expect(
      authorizeOutboundVoice("technician", {
        type: "pstn",
        toE164: "+14165551234",
        callerId: "+14165550000",
      })
    ).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("rejects PSTN when the location has no shop number", () => {
    expect(
      authorizeOutboundVoice("owner", {
        type: "pstn",
        toE164: "+14165551234",
        callerId: null,
      })
    ).toEqual({ ok: false, code: "SHOP_PHONE_NOT_CONFIGURED" });
  });

  it("allows messenger staff to place a staff audio call", () => {
    expect(
      authorizeOutboundVoice("technician", {
        type: "staff",
        identity: "user_550e8400e29b41d4a716446655440000",
      })
    ).toEqual({ ok: true });
  });

  it("rejects staff audio for the kiosk", () => {
    expect(
      authorizeOutboundVoice("time_clock_kiosk", {
        type: "staff",
        identity: "user_550e8400e29b41d4a716446655440000",
      })
    ).toEqual({ ok: false, code: "FORBIDDEN" });
  });
});
