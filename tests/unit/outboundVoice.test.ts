import { describe, expect, it } from "vitest";
import { authorizeOutboundVoice } from "@/lib/twilio/outboundVoice";

describe("authorizeOutboundVoice", () => {
  it("allows front office to place PSTN calls", () => {
    expect(authorizeOutboundVoice({ role: "service_advisor", channel: "pstn" })).toEqual({
      ok: true,
    });
  });

  it("rejects PSTN for technicians", () => {
    expect(authorizeOutboundVoice({ role: "technician", channel: "pstn" })).toEqual({
      ok: false,
      error: "FORBIDDEN",
    });
  });

  it("allows any messenger role to place staff audio", () => {
    expect(authorizeOutboundVoice({ role: "technician", channel: "staff" })).toEqual({
      ok: true,
    });
    expect(
      authorizeOutboundVoice({ role: "time_clock_kiosk", channel: "staff" })
    ).toEqual({
      ok: false,
      error: "FORBIDDEN",
    });
  });
});
