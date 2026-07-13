import { describe, expect, it } from "vitest";
import { buildWixContactInfo } from "@/lib/wix/client";
import {
  extractWixContactFields,
  findMatchingCustomer,
  firstNonEmpty,
  normalizeOptional,
} from "@/lib/wix/contactNormalize";
import type { WixContact } from "@/lib/wix/types";

describe("buildWixContactInfo", () => {
  it("includes name, email, and phone when provided", () => {
    expect(
      buildWixContactInfo({
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@example.com",
        phone: "555-0100",
      })
    ).toEqual({
      name: { first: "Ada", last: "Lovelace" },
      emails: { items: [{ tag: "MAIN", email: "ada@example.com", primary: true }] },
      phones: { items: [{ tag: "MOBILE", phone: "555-0100", primary: true }] },
    });
  });

  it("omits empty email and phone", () => {
    expect(
      buildWixContactInfo({
        firstName: "Ada",
        lastName: "Lovelace",
        email: "  ",
        phone: null,
      })
    ).toEqual({
      name: { first: "Ada", last: "Lovelace" },
    });
  });
});

describe("contactNormalize", () => {
  it("normalizeOptional trims and drops empty", () => {
    expect(normalizeOptional("  a@b.com  ")).toBe("a@b.com");
    expect(normalizeOptional("   ")).toBeNull();
    expect(normalizeOptional(null)).toBeNull();
  });

  it("firstNonEmpty returns first usable value", () => {
    expect(firstNonEmpty("  ", null, "Ada")).toBe("Ada");
    expect(firstNonEmpty(undefined, undefined)).toBe("");
  });

  it("extractWixContactFields prefers primaryInfo and skips empty contacts", () => {
    const contact: WixContact = {
      id: "wix-1",
      info: {
        name: { first: "Ada", last: "Lovelace" },
        emails: { items: [{ email: "fallback@example.com", primary: true }] },
        phones: { items: [{ phone: "555-0000", primary: true }] },
      },
      primaryInfo: { email: "ada@example.com", phone: "555-0100" },
    };
    expect(extractWixContactFields(contact)).toEqual({
      wixContactId: "wix-1",
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.com",
      phone: "555-0100",
    });

    expect(
      extractWixContactFields({
        id: "wix-2",
        info: { name: { first: "No", last: "Contact" } },
      })
    ).toBeNull();
  });

  it("findMatchingCustomer matches wix id, then email, then phone", () => {
    const rows = [
      {
        customer_id: "c1",
        email: "old@example.com",
        phone: "111",
        wix_contact_id: "wix-a",
      },
      {
        customer_id: "c2",
        email: "Ada@Example.com",
        phone: "222",
        wix_contact_id: null,
      },
      {
        customer_id: "c3",
        email: null,
        phone: "333",
        wix_contact_id: null,
      },
    ];

    expect(
      findMatchingCustomer(rows, {
        wixContactId: "wix-a",
        email: "other@example.com",
        phone: "999",
      })?.customer_id
    ).toBe("c1");

    expect(
      findMatchingCustomer(rows, {
        wixContactId: "missing",
        email: "ada@example.com",
        phone: null,
      })?.customer_id
    ).toBe("c2");

    expect(
      findMatchingCustomer(rows, {
        wixContactId: "missing",
        email: null,
        phone: "333",
      })?.customer_id
    ).toBe("c3");

    expect(
      findMatchingCustomer(rows, {
        wixContactId: "missing",
        email: null,
        phone: "999",
      })
    ).toBeNull();
  });
});
