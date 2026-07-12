import { describe, expect, it } from "vitest";
import { buildWixContactInfo } from "@/lib/wix/client";
import { buildInvoiceLineItems } from "@/lib/wix/invoices";

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

describe("buildInvoiceLineItems", () => {
  it("includes billable jobs and non-cancelled parts", () => {
    const lines = buildInvoiceLineItems({
      workOrderNumber: "WO-1001",
      jobs: [
        {
          service_name_snapshot: "Oil change",
          standard_price_snapshot: 89.99,
          status: "completed",
        },
        {
          service_name_snapshot: "Declined job",
          standard_price_snapshot: 40,
          status: "declined",
        },
      ],
      parts: [
        {
          part_name: "Oil filter",
          part_number: "OF-1",
          quantity: 2,
          unit_price: 12.5,
          status: "installed",
        },
        {
          part_name: "Cancelled part",
          part_number: null,
          quantity: 1,
          unit_price: 9,
          status: "cancelled",
        },
      ],
    });

    expect(lines).toEqual([
      {
        name: "Oil change",
        description: "Labour · WO-1001",
        quantity: 1,
        price: 89.99,
      },
      {
        name: "Oil filter",
        description: "Part OF-1 · WO-1001",
        quantity: 2,
        price: 12.5,
      },
    ]);
  });

  it("defaults missing prices to 0", () => {
    const lines = buildInvoiceLineItems({
      workOrderNumber: "WO-2",
      jobs: [
        {
          service_name_snapshot: "Diag",
          standard_price_snapshot: null,
          status: "approved",
        },
      ],
      parts: [],
    });
    expect(lines[0]?.price).toBe(0);
  });
});
