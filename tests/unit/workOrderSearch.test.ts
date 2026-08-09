import { describe, it, expect } from "vitest";
import {
  isWoNumberPrefixMatch,
  matchesWorkOrderSearch,
  normalizeWoToken,
  type WorkOrderSearchFields,
} from "@/lib/services/workOrderSearch";

function fields(overrides: Partial<WorkOrderSearchFields> = {}): WorkOrderSearchFields {
  return {
    work_order_number: "WO-1001",
    external_invoice_number: "INV-9",
    customer_first_name: "Ada",
    customer_last_name: "Lovelace",
    customer_phone: "555-0100",
    bike_year: 2020,
    bike_make: "Honda",
    bike_model: "CBR600",
    bike_vin: "JH2PC4000XM000001",
    ...overrides,
  };
}

describe("normalizeWoToken", () => {
  it("collapses optional hyphen after WO", () => {
    expect(normalizeWoToken("WO-1001")).toBe("wo1001");
    expect(normalizeWoToken("WO1001")).toBe("wo1001");
    expect(normalizeWoToken("wo-1001")).toBe("wo1001");
  });
});

describe("isWoNumberPrefixMatch", () => {
  it("matches with or without hyphen", () => {
    expect(isWoNumberPrefixMatch("WO-1001", "WO-1001")).toBe(true);
    expect(isWoNumberPrefixMatch("WO1001", "WO-1001")).toBe(true);
    expect(isWoNumberPrefixMatch("WO-10", "WO-1001")).toBe(true);
    expect(isWoNumberPrefixMatch("WO2001", "WO-1001")).toBe(false);
  });
});

describe("matchesWorkOrderSearch", () => {
  it("matches empty query", () => {
    expect(matchesWorkOrderSearch(fields(), "")).toBe(true);
    expect(matchesWorkOrderSearch(fields(), "   ")).toBe(true);
  });

  it("matches work order number, customer, and bike", () => {
    expect(matchesWorkOrderSearch(fields(), "WO-1001")).toBe(true);
    expect(matchesWorkOrderSearch(fields(), "WO1001")).toBe(true);
    expect(matchesWorkOrderSearch(fields(), "ada")).toBe(true);
    expect(matchesWorkOrderSearch(fields(), "honda")).toBe(true);
    expect(matchesWorkOrderSearch(fields(), "cbr")).toBe(true);
    expect(matchesWorkOrderSearch(fields(), "XM000001")).toBe(true);
    expect(matchesWorkOrderSearch(fields(), "INV-9")).toBe(true);
  });

  it("is case-insensitive and requires a haystack hit", () => {
    expect(matchesWorkOrderSearch(fields(), "LOVELACE")).toBe(true);
    expect(matchesWorkOrderSearch(fields(), "yamaha")).toBe(false);
  });
});
