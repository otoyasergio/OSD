import { describe, expect, it } from "vitest";
import {
  missedCallTwiml,
  outboundPstnTwiml,
  outboundStaffTwiml,
  inboundDialClientsTwiml,
} from "@/lib/twilio/voiceTwiml";

describe("voice TwiML", () => {
  it("plays a short missed-shop message when nobody is registered", () => {
    const xml = missedCallTwiml();
    expect(xml).toContain("<Say");
    expect(xml).toContain("Toronto Moto");
    expect(xml).toContain("<Hangup");
    expect(xml).not.toContain("<Dial");
  });

  it("dials every registered client identity for inbound PSTN", () => {
    const xml = inboundDialClientsTwiml({
      identities: ["user_aaa", "user_bbb"],
      timeoutSeconds: 25,
    });
    expect(xml).toContain("<Client>user_aaa</Client>");
    expect(xml).toContain("<Client>user_bbb</Client>");
    expect(xml).toContain('timeout="25"');
  });

  it("dials a customer number with the shop caller ID", () => {
    const xml = outboundPstnTwiml({
      toE164: "+14165551234",
      callerId: "+14165550000",
    });
    expect(xml).toContain("<Number>+14165551234</Number>");
    expect(xml).toContain('callerId="+14165550000"');
  });

  it("dials a staff Client identity for internal audio", () => {
    const xml = outboundStaffTwiml({ identity: "user_550e8400e29b41d4a716446655440000" });
    expect(xml).toContain("<Client>user_550e8400e29b41d4a716446655440000</Client>");
    expect(xml).not.toContain("callerId");
  });
});
