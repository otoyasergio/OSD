import { describe, expect, it } from "vitest";
import {
  buildPhoneLookupVariants,
  mergeDuplicateCandidates,
  normalizePhoneForMatching,
} from "@/lib/customers/duplicates";

const ada = {
  customer_id: "00000000-0000-4000-8000-000000000001",
  first_name: "Ada",
  last_name: "Lovelace",
  phone: "416-555-1234",
  email: "Ada@Example.com",
};

describe("customer duplicate matching", () => {
  it("normalizes common North American phone formats", () => {
    expect(normalizePhoneForMatching("+1 (416) 555-1234")).toBe("4165551234");
    expect(normalizePhoneForMatching("416.555.1234")).toBe("4165551234");
    expect(normalizePhoneForMatching("555-1234")).toBe("");
  });

  it("builds lookup variants for legacy stored phone formats", () => {
    expect(buildPhoneLookupVariants("4165551234")).toContain("(416) 555-1234");
    expect(buildPhoneLookupVariants("4165551234")).toContain("+14165551234");
  });

  it("merges phone and email hits into one warning", () => {
    expect(
      mergeDuplicateCandidates({
        emailRows: [ada],
        phoneRows: [ada],
        email: " ada@example.com ",
        phone: "(416) 555-1234",
      })
    ).toEqual([{ ...ada, matched_fields: ["email", "phone"] }]);
  });
});
