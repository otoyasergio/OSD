import { afterEach, describe, expect, it, vi } from "vitest";
import { buildWixContactInfo, listAllWixContacts } from "@/lib/wix/client";
import {
  extractWixContactFields,
  findMatchingCustomer,
  firstNonEmpty,
  isCustomerInSyncWithWix,
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

describe("listAllWixContacts", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("retries one contacts page when Wix closes the connection", async () => {
    vi.stubEnv("WIX_API_KEY", "test-key");
    vi.stubEnv("WIX_SITE_ID", "site-1");
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("Connection closed after GOAWAY. HTTP/2 error code: INTERNAL_ERROR")
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            contacts: [{ id: "c1" }],
            pagingMetadata: { hasNext: false, total: 1 },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );
    vi.stubGlobal("fetch", fetchImpl);

    await expect(listAllWixContacts()).resolves.toEqual([{ id: "c1" }]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry a contacts query Wix rejected", async () => {
    vi.stubEnv("WIX_API_KEY", "test-key");
    vi.stubEnv("WIX_SITE_ID", "site-1");
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "bad filter" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchImpl);

    await expect(listAllWixContacts()).rejects.toThrow(/bad filter|WIX_HTTP_400/);
    expect(fetchImpl).toHaveBeenCalledOnce();
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
        first_name: "Ada",
        last_name: "Lovelace",
        email: "old@example.com",
        phone: "111",
        wix_contact_id: "wix-a",
      },
      {
        customer_id: "c2",
        first_name: "Ada",
        last_name: "Lovelace",
        email: "Ada@Example.com",
        phone: "222",
        wix_contact_id: null,
      },
      {
        customer_id: "c3",
        first_name: "No",
        last_name: "Email",
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

  it("isCustomerInSyncWithWix skips no-op updates", () => {
    const existing = {
      customer_id: "c1",
      first_name: "Ada",
      last_name: "Lovelace",
      email: "ada@example.com",
      phone: "555-0100",
      wix_contact_id: "wix-1",
    };
    const fields = {
      wixContactId: "wix-1",
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.com",
      phone: "555-0100",
    };

    expect(isCustomerInSyncWithWix(existing, fields)).toBe(true);
    expect(isCustomerInSyncWithWix(existing, { ...fields, firstName: "Augusta" })).toBe(
      false
    );
    expect(isCustomerInSyncWithWix({ ...existing, wix_contact_id: null }, fields)).toBe(
      false
    );
  });

  it("customersNeedingWixPush selects local rows that were never linked", async () => {
    const { customersNeedingWixPush } = await import("@/lib/wix/contactNormalize");
    const linked = {
      customer_id: "c1",
      first_name: "Ada",
      last_name: "Lovelace",
      email: "ada@example.com",
      phone: "555-0100",
      wix_contact_id: "wix-1",
    };
    const unlinked = { ...linked, customer_id: "c2", wix_contact_id: null };
    expect(customersNeedingWixPush([linked, unlinked])).toEqual([unlinked]);
  });

  it("sanitizeWixPushProfile trims names and drops non-phone values", async () => {
    const { sanitizeWixPushProfile } = await import("@/lib/wix/contactNormalize");
    expect(
      sanitizeWixPushProfile({
        customer_id: "c1",
        first_name: "Mazhar ",
        last_name: "Ahmad",
        email: "mazhar@example.com",
        phone: "(437) 974-4783",
        wix_contact_id: null,
      })
    ).toEqual({
      firstName: "Mazhar",
      lastName: "Ahmad",
      email: "mazhar@example.com",
      phone: "(437) 974-4783",
    });
    expect(
      sanitizeWixPushProfile({
        customer_id: "c2",
        first_name: "Mark",
        last_name: "Pozarlik",
        email: "mark@example.com",
        phone: "Pozarlik",
        wix_contact_id: null,
      }).phone
    ).toBeNull();
  });

  it("wixContactAlreadyLinkedToOtherCustomer detects duplicate local rows", async () => {
    const { wixContactAlreadyLinkedToOtherCustomer } =
      await import("@/lib/wix/contactNormalize");
    const rows = [
      {
        customer_id: "original",
        first_name: "Mazhar",
        last_name: "Ahmad",
        email: "a@example.com",
        phone: "4379744783",
        wix_contact_id: "wix-1",
      },
      {
        customer_id: "duplicate",
        first_name: "Mazhar ",
        last_name: "Ahmad",
        email: "a@example.com",
        phone: "4379744783",
        wix_contact_id: null,
      },
    ];
    expect(
      wixContactAlreadyLinkedToOtherCustomer(rows, {
        customerId: "duplicate",
        wixContactId: "wix-1",
      })
    ).toBe(true);
    expect(
      wixContactAlreadyLinkedToOtherCustomer(rows, {
        customerId: "original",
        wixContactId: "wix-1",
      })
    ).toBe(false);
  });
});
