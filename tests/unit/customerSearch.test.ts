import { describe, expect, it } from "vitest";
import { filterKnownCustomerMatches } from "@/lib/forms/customerSearch";
import {
  buildCustomerSearchOrFilter,
  escapeSearchTerm,
  type Customer,
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
    expect(buildCustomerSearchOrFilter("a_b")).toContain("first_name.ilike.%a\\_b%");
  });

  it("also matches digit-only phone when the query has punctuation", () => {
    expect(buildCustomerSearchOrFilter("(416) 751-6488")).toContain(
      "phone.ilike.%4167516488%"
    );
  });
});

function customer(overrides: Partial<Customer>): Customer {
  return {
    customer_id: "customer-1",
    first_name: "Avery",
    last_name: "Rider",
    phone: "(416) 555-0199",
    email: "avery@example.com",
    address: null,
    date_of_birth: null,
    notes: null,
    account_type: "retail",
    wix_contact_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("filterKnownCustomerMatches", () => {
  const rows = [
    customer({ customer_id: "avery" }),
    customer({
      customer_id: "jules",
      first_name: "Jules",
      last_name: "Martin",
      phone: "6472442520",
      email: "jules@example.com",
    }),
  ];

  it("narrows immediately by name or email", () => {
    expect(
      filterKnownCustomerMatches(rows, "mart").map((row) => row.customer_id)
    ).toEqual(["jules"]);
    expect(
      filterKnownCustomerMatches(rows, "AVERY@EXAMPLE").map((row) => row.customer_id)
    ).toEqual(["avery"]);
  });

  it("matches formatted phone numbers by digits", () => {
    expect(
      filterKnownCustomerMatches(rows, "647-244").map((row) => row.customer_id)
    ).toEqual(["jules"]);
  });

  it("returns no stale options when known rows do not match", () => {
    expect(filterKnownCustomerMatches(rows, "not-in-the-cache")).toEqual([]);
  });
});
