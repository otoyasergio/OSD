import { describe, expect, it } from "vitest";
import { TORONTO_SHOP } from "@/lib/shop/toronto";
import { LEGAL_ENTITY_NAME } from "@/lib/wix/invoiceRules";

describe("shop legal name", () => {
  it("uses the Toronto legal entity for Wix invoice gates", () => {
    expect(LEGAL_ENTITY_NAME).toBe(TORONTO_SHOP.legalName);
    expect(TORONTO_SHOP.legalName).toBe("OTOMOTO TORONTO MOTO INC.");
  });
});
