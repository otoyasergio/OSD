import { describe, expect, it } from "vitest";
import {
  PARTS_MARGIN_FLOOR_BPS,
  invoiceCheck,
  partsMarginBps,
  promiseAssumesFullDelivery,
  requirementStateAfterReceipt,
  thinPartsMargin,
} from "@/lib/purchasing/controls";

describe("purchasing controls", () => {
  it("marks a short receipt as partial and a full receipt as received", () => {
    expect(
      requirementStateAfterReceipt({ quantityOrdered: 2, quantityReceived: 1 })
    ).toBe("partially_received");
    expect(
      requirementStateAfterReceipt({ quantityOrdered: 2, quantityReceived: 2 })
    ).toBe("received");
  });

  it("blocks a promise date that assumes a full delivery while a line is short", () => {
    expect(
      promiseAssumesFullDelivery({
        hasPromise: true,
        lines: [{ ordered: 2, received: 1 }],
      })
    ).toBe(true);
    expect(
      promiseAssumesFullDelivery({
        hasPromise: true,
        lines: [{ ordered: 2, received: 2 }],
      })
    ).toBe(false);
  });

  it("flags a supplier invoice that does not match received cost plus freight", () => {
    expect(
      invoiceCheck({
        invoiceTotalCents: 5000,
        receivedCostCents: 4000,
        freightCents: 500,
        costComplete: true,
      })
    ).toBe("mismatch");
    expect(
      invoiceCheck({
        invoiceTotalCents: 4500,
        receivedCostCents: 4000,
        freightCents: 500,
        costComplete: true,
      })
    ).toBe("match");
    expect(
      invoiceCheck({
        invoiceTotalCents: 4500,
        receivedCostCents: 0,
        freightCents: 0,
        costComplete: false,
      })
    ).toBe("cost_missing");
  });

  it("leaves margin empty until acquisition cost is known, then flags a thin margin", () => {
    expect(partsMarginBps({ sellCents: 10000, costCents: null })).toBeNull();
    expect(thinPartsMargin({ sellCents: 10000, costCents: null })).toBe(false);
    const margin = partsMarginBps({ sellCents: 10000, costCents: 9000 });
    expect(margin).toBe(1000);
    expect(margin).toBeLessThan(PARTS_MARGIN_FLOOR_BPS);
    expect(thinPartsMargin({ sellCents: 10000, costCents: 9000 })).toBe(true);
  });
});
