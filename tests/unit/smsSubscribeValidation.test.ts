import { describe, expect, it } from "vitest";
import { validateSmsSubscribeInput } from "@/lib/sms/subscribeValidation";

describe("validateSmsSubscribeInput", () => {
  it("rejects empty phone", () => {
    expect(
      validateSmsSubscribeInput({
        phone: "   ",
        transactional: true,
        marketing: false,
      })
    ).toEqual({ ok: false, error: "Phone is required." });
  });

  it("rejects when no message type is selected", () => {
    expect(
      validateSmsSubscribeInput({
        phone: "4165551234",
        transactional: false,
        marketing: false,
      })
    ).toEqual({ ok: false, error: "Choose at least one message type." });
  });

  it("accepts valid phone with at least one program", () => {
    expect(
      validateSmsSubscribeInput({
        phone: "4165551234",
        transactional: true,
        marketing: false,
      })
    ).toEqual({ ok: true });
  });
});
