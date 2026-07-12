import { describe, expect, it } from "vitest";
import {
  parseInventoryCsv,
  supplierStockTotal,
} from "@/lib/partsCanada/parseInventory";

describe("parseInventoryCsv", () => {
  it("parses Parts Canada-style inventory headers", () => {
    const csv = [
      "Part Number,Brand,Description EN,MSRP Latest,Dealer Price,CAL Qty Available,Lon Qty Available",
      'YTX14-BS,Yuasa,"Battery, AGM",89.99,54.10,3,12',
      "BAD,,No number missing should skip?,,,,",
    ].join("\n");

    // Second row has part number; third also has BAD as part number — both kept
    const rows = parseInventoryCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      part_number: "YTX14-BS",
      brand: "Yuasa",
      description_en: "Battery, AGM",
      msrp: 89.99,
      dealer_price: 54.1,
      qty_cal: 3,
      qty_lon: 12,
    });
  });

  it("skips rows without a part number", () => {
    const csv = [
      "Part Number,Description EN,MSRP Latest",
      ",Empty part,10",
      "ABC-1,Valid,12.5",
    ].join("\n");
    const rows = parseInventoryCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.part_number).toBe("ABC-1");
  });
});

describe("supplierStockTotal", () => {
  it("sums warehouse quantities", () => {
    expect(supplierStockTotal(3, 12)).toBe(15);
    expect(supplierStockTotal(null, 4)).toBe(4);
    expect(supplierStockTotal(null, null)).toBeNull();
  });
});
