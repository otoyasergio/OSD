import { describe, expect, it } from "vitest";
import { classifyBillingBucket } from "@/lib/billing/buckets";
import {
  canViewBillingArea,
  canViewBillingLedger,
  canViewBillingMoneyDesk,
  canViewBillingTab,
  defaultBillingTab,
} from "@/lib/permissions/checks";

describe("billing permissions", () => {
  it("hides billing from technicians", () => {
    expect(canViewBillingArea("technician")).toBe(false);
    expect(canViewBillingArea("service_advisor")).toBe(true);
  });

  it("gates money desk and ledger to owner/manager", () => {
    expect(canViewBillingMoneyDesk("service_advisor")).toBe(false);
    expect(canViewBillingMoneyDesk("manager")).toBe(true);
    expect(canViewBillingLedger("owner")).toBe(true);
    expect(canViewBillingTab("service_advisor", "ledger")).toBe(false);
    expect(canViewBillingTab("manager", "ledger")).toBe(true);
  });

  it("defaults tabs by role", () => {
    expect(defaultBillingTab("service_advisor")).toBe("collections");
    expect(defaultBillingTab("manager")).toBe("money_desk");
    expect(defaultBillingTab("owner")).toBe("ledger");
  });
});

describe("classifyBillingBucket", () => {
  it("marks ready_to_invoice and unpaid", () => {
    expect(
      classifyBillingBucket({
        billing_stage: "ready_to_invoice",
        square_payment_status: null,
        billing_collected_cents: 0,
        estimate_cents: 10000,
      })
    ).toBe("ready_to_invoice");

    expect(
      classifyBillingBucket({
        billing_stage: "invoiced",
        square_payment_status: "unpaid",
        billing_collected_cents: 0,
        estimate_cents: 10000,
      })
    ).toBe("unpaid");
  });

  it("marks balance due after deposit", () => {
    expect(
      classifyBillingBucket({
        billing_stage: "ready_to_invoice",
        square_payment_status: "paid",
        billing_collected_cents: 4000,
        estimate_cents: 10000,
      })
    ).toBe("balance_due");
  });
});
