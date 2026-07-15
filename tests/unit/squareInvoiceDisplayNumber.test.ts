import { describe, expect, it } from "vitest";
import { squareInvoiceDisplayNumber } from "@/lib/square/client";

describe("squareInvoiceDisplayNumber", () => {
  it("prefers Square invoice_number over id", () => {
    expect(
      squareInvoiceDisplayNumber({
        invoice_number: "0000042",
        id: "inv:0-ChABC",
      })
    ).toBe("0000042");
  });

  it("falls back to id when invoice_number is missing", () => {
    expect(
      squareInvoiceDisplayNumber({
        id: "inv:0-ChABC",
      })
    ).toBe("inv:0-ChABC");
  });

  it("returns null when neither is present", () => {
    expect(squareInvoiceDisplayNumber({})).toBeNull();
    expect(
      squareInvoiceDisplayNumber({ invoice_number: "  ", id: "" })
    ).toBeNull();
  });
});
