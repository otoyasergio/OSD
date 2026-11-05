import { describe, expect, it } from "vitest";
import { classifyShopExceptions } from "@/lib/reports/exceptions";

const now = "2026-11-01T15:00:00.000Z";

describe("classifyShopExceptions", () => {
  it("flags a stalled open job, a missed promise, unbilled finished work, and an unpaid invoice", () => {
    expect(
      classifyShopExceptions({
        status: "in_progress",
        lastJobActivityAt: "2026-10-27T12:00:00.000Z",
        estimatedCompletion: "2026-10-30T20:00:00.000Z",
        billingStage: "none",
        billingAmountCents: 0,
        billingCollectedCents: 0,
        partsMarginThin: false,
        supplierCreditCents: 0,
        now,
      })
    ).toEqual(["stalled", "promise_missed"]);

    expect(
      classifyShopExceptions({
        status: "ready_for_pickup",
        lastJobActivityAt: now,
        estimatedCompletion: "2026-11-05T20:00:00.000Z",
        billingStage: "ready_to_invoice",
        billingAmountCents: 20000,
        billingCollectedCents: 0,
        partsMarginThin: false,
        supplierCreditCents: 0,
        now,
      })
    ).toEqual(["unbilled"]);

    expect(
      classifyShopExceptions({
        status: "completed",
        lastJobActivityAt: now,
        estimatedCompletion: null,
        billingStage: "invoiced",
        billingAmountCents: 20000,
        billingCollectedCents: 5000,
        partsMarginThin: true,
        supplierCreditCents: 1500,
        now,
      })
    ).toEqual(["unpaid", "thin_margin", "supplier_credit"]);
  });

  it("does not call a parked, closed, or fully collected bike a missed promise or a stall", () => {
    for (const status of ["in_storage", "insurance", "cancelled"] as const) {
      expect(
        classifyShopExceptions({
          status,
          lastJobActivityAt: "2026-10-01T12:00:00.000Z",
          estimatedCompletion: "2026-10-30T20:00:00.000Z",
          billingStage: "paid",
          billingAmountCents: 10000,
          billingCollectedCents: 10000,
          partsMarginThin: false,
          supplierCreditCents: 0,
          now,
        })
      ).toEqual([]);
    }

    expect(
      classifyShopExceptions({
        status: "ready_for_pickup",
        lastJobActivityAt: "2026-10-01T12:00:00.000Z",
        estimatedCompletion: "2026-11-05T20:00:00.000Z",
        billingStage: "invoiced",
        billingAmountCents: 10000,
        billingCollectedCents: 10000,
        partsMarginThin: false,
        supplierCreditCents: 0,
        now,
      })
    ).toEqual([]);
  });

  it("still flags finished storage that has not been invoiced", () => {
    expect(
      classifyShopExceptions({
        status: "in_storage",
        lastJobActivityAt: now,
        estimatedCompletion: null,
        billingStage: "ready_to_invoice",
        billingAmountCents: 0,
        billingCollectedCents: 0,
        partsMarginThin: false,
        supplierCreditCents: 0,
        now,
      })
    ).toEqual(["unbilled"]);
  });

  it("does not treat a paid, moving bike as an exception", () => {
    expect(
      classifyShopExceptions({
        status: "in_progress",
        lastJobActivityAt: "2026-11-01T14:00:00.000Z",
        estimatedCompletion: "2026-11-04T20:00:00.000Z",
        billingStage: "paid",
        billingAmountCents: 10000,
        billingCollectedCents: 10000,
        partsMarginThin: false,
        supplierCreditCents: 0,
        now,
      })
    ).toEqual([]);
  });
});
