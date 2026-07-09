import { describe, it, expect } from "vitest";
import {
  escapeSearchTerm,
  buildCustomerSearchOrFilter,
} from "@/lib/services/customers";

describe("escapeSearchTerm", () => {
  it("escapes ilike wildcards", () => {
    expect(escapeSearchTerm("50%_off")).toBe("50\\%\\_off");
  });

  it("strips characters that break PostgREST or() syntax", () => {
    expect(escapeSearchTerm("smith,(jane)")).toBe("smithjane");
  });

  it("trims surrounding whitespace", () => {
    expect(escapeSearchTerm("  ada  ")).toBe("ada");
  });
});

describe("buildCustomerSearchOrFilter", () => {
  it("searches first name, last name, phone, and email", () => {
    expect(buildCustomerSearchOrFilter("ada")).toBe(
      "first_name.ilike.%ada%,last_name.ilike.%ada%,phone.ilike.%ada%,email.ilike.%ada%"
    );
  });

  it("applies escaping to the pattern", () => {
    expect(buildCustomerSearchOrFilter("a_b")).toContain(
      "first_name.ilike.%a\\_b%"
    );
  });
});
