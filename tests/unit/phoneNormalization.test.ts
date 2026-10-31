import { describe, expect, it } from "vitest";
import { normalizePhoneE164 } from "@/lib/phone/e164";

describe("normalizePhoneE164", () => {
  it("normalizes 10-digit North American numbers", () => {
    expect(normalizePhoneE164("(416) 555-1234")).toBe("+14165551234");
  });

  it("keeps valid E.164 numbers", () => {
    expect(normalizePhoneE164("+14165551234")).toBe("+14165551234");
  });

  it("rejects short numbers", () => {
    expect(normalizePhoneE164("5551234")).toBeNull();
  });
});
