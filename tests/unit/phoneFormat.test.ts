import { describe, expect, it } from "vitest";
import { formatCanadianPhoneInput } from "@/lib/phone/format";

describe("formatCanadianPhoneInput", () => {
  it("formats a Canadian number as it is entered", () => {
    expect(formatCanadianPhoneInput("416")).toBe("416");
    expect(formatCanadianPhoneInput("416555")).toBe("(416) 555");
    expect(formatCanadianPhoneInput("4165551234")).toBe("(416) 555-1234");
  });

  it("removes a pasted North American country code", () => {
    expect(formatCanadianPhoneInput("+1 416 555 1234")).toBe("(416) 555-1234");
    expect(formatCanadianPhoneInput("14165551234")).toBe("(416) 555-1234");
  });

  it("preserves international numbers and extensions", () => {
    expect(formatCanadianPhoneInput("+44 20 7946 0958")).toBe("+44 20 7946 0958");
    expect(formatCanadianPhoneInput("(416) 555-1234 ext 9")).toBe("(416) 555-1234 ext 9");
  });
});
