import { describe, expect, it } from "vitest";
import {
  inboundPstnTwiml,
  missedCallTwiml,
  outboundPstnTwiml,
  staffAudioTwiml,
} from "@/lib/twilio/voiceTwiml";

describe("voice TwiML", () => {
  it("plays a short missed message and hangs up when nobody is registered", () => {
    const xml = missedCallTwiml();
    expect(xml).toContain("<Say>");
    expect(xml).toContain("<Hangup");
    expect(xml).not.toContain("<Dial");
    expect(xml).not.toContain("<Record");
  });

  it("dials registered client identities for inbound PSTN", () => {
    const xml = inboundPstnTwiml({
      identities: ["user_aaa", "user_bbb"],
      actionUrl: "https://service.torontomoto.com/api/twilio/voice/dial-action",
    });
    expect(xml).toContain("<Dial");
    expect(xml).toContain("<Client>user_aaa</Client>");
    expect(xml).toContain("<Client>user_bbb</Client>");
    expect(xml).toContain("dial-action");
    expect(xml).not.toContain("<Record");
  });

  it("falls back to missed TwiML when inbound has no identities", () => {
    const xml = inboundPstnTwiml({ identities: [] });
    expect(xml).toContain("<Say>");
    expect(xml).not.toContain("<Client");
  });

  it("dials the customer number with the shop caller id", () => {
    const xml = outboundPstnTwiml({
      toE164: "+14165559876",
      callerId: "+14165551212",
    });
    expect(xml).toContain('callerId="+14165551212"');
    expect(xml).toContain("<Number>+14165559876</Number>");
    expect(xml).not.toContain("<Record");
  });

  it("dials a single staff client for 1:1 audio", () => {
    const xml = staffAudioTwiml({ identities: ["user_aaa"] });
    expect(xml).toContain("<Client>user_aaa</Client>");
    expect(xml).not.toContain("<Conference");
  });

  it("uses a conference for group staff audio", () => {
    const xml = staffAudioTwiml({
      identities: ["user_aaa", "user_bbb"],
      conferenceName: "staff-conv-1",
    });
    expect(xml).toContain("<Conference");
    expect(xml).toContain("staff-conv-1");
  });
});
