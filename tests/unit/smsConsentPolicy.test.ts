import { describe, expect, it } from "vitest";
import {
  canSendTransactionalSms,
  canSendMarketingSms,
  classifyInboundSmsKeyword,
  buildHelpReply,
  buildOptOutReply,
  buildOptInConfirmation,
  type SmsConsentSnapshot,
} from "@/lib/sms/consentPolicy";

const base: SmsConsentSnapshot = {
  sms_opted_out_at: null,
  sms_transactional_consent_at: null,
  sms_marketing_consent_at: null,
  sms_consent_source: null,
};

describe("canSendTransactionalSms", () => {
  it("blocks when opted out", () => {
    expect(
      canSendTransactionalSms({
        ...base,
        sms_opted_out_at: "2026-07-01T00:00:00Z",
      })
    ).toBe(false);
  });

  it("allows legacy when both consents null and never touched", () => {
    expect(canSendTransactionalSms(base)).toBe(true);
  });

  it("requires transactional flag after consent UI touch", () => {
    expect(canSendTransactionalSms({ ...base, sms_consent_source: "staff" })).toBe(false);
    expect(
      canSendTransactionalSms({
        ...base,
        sms_consent_source: "staff",
        sms_transactional_consent_at: "2026-07-01T00:00:00Z",
      })
    ).toBe(true);
  });
});

describe("canSendMarketingSms", () => {
  it("requires marketing consent and not opted out", () => {
    expect(canSendMarketingSms(base)).toBe(false);
    expect(
      canSendMarketingSms({
        ...base,
        sms_marketing_consent_at: "2026-07-01T00:00:00Z",
      })
    ).toBe(true);
    expect(
      canSendMarketingSms({
        ...base,
        sms_marketing_consent_at: "2026-07-01T00:00:00Z",
        sms_opted_out_at: "2026-07-02T00:00:00Z",
      })
    ).toBe(false);
  });
});

describe("classifyInboundSmsKeyword", () => {
  it("classifies STOP including HALT", () => {
    expect(classifyInboundSmsKeyword("stop")).toBe("opt_out");
    expect(classifyInboundSmsKeyword("HALT")).toBe("opt_out");
  });

  it("classifies HELP and START", () => {
    expect(classifyInboundSmsKeyword("HELP")).toBe("help");
    expect(classifyInboundSmsKeyword("START")).toBe("opt_in_clear");
  });

  it("returns other for free text", () => {
    expect(classifyInboundSmsKeyword("when ready?")).toBe("other");
  });
});

describe("reply copy", () => {
  it("builds HELP / STOP / welcome strings with Toronto Moto", () => {
    expect(buildHelpReply()).toContain("torontomoto.com");
    expect(buildHelpReply()).toContain("STOP");
    expect(buildOptOutReply()).toContain("unsubscribed");
    expect(buildOptInConfirmation(["transactional", "marketing"])).toContain("Welcome");
  });
});
