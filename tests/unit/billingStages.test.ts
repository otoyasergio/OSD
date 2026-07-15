import { describe, expect, it } from "vitest";
import {
  computePublishAmountCents,
  stageAfterJobApprovals,
} from "@/lib/billing/stages";

describe("computePublishAmountCents", () => {
  it("charges full remaining", () => {
    expect(
      computePublishAmountCents({
        mode: "full",
        billableTotalCents: 100_00,
        collectedCents: 25_00,
      })
    ).toBe(75_00);
  });

  it("computes deposit percent capped at remaining", () => {
    expect(
      computePublishAmountCents({
        mode: "deposit_percent",
        billableTotalCents: 100_00,
        collectedCents: 0,
        depositPercent: 50,
      })
    ).toBe(50_00);
  });

  it("caps custom amount at remaining", () => {
    expect(
      computePublishAmountCents({
        mode: "custom",
        billableTotalCents: 100_00,
        collectedCents: 80_00,
        customCents: 50_00,
      })
    ).toBe(20_00);
  });

  it("returns 0 when nothing remains", () => {
    expect(
      computePublishAmountCents({
        mode: "balance",
        billableTotalCents: 100_00,
        collectedCents: 100_00,
      })
    ).toBe(0);
  });
});

describe("stageAfterJobApprovals", () => {
  it("moves to ready_to_invoice when publishable lines exist", () => {
    expect(
      stageAfterJobApprovals({
        current: "awaiting_approval",
        hasPublishableLines: true,
        hasAwaitingApproval: true,
        hasSquareDraft: true,
        estimateSent: true,
      })
    ).toBe("ready_to_invoice");
  });

  it("keeps awaiting_approval when estimate sent and still waiting", () => {
    expect(
      stageAfterJobApprovals({
        current: "awaiting_approval",
        hasPublishableLines: false,
        hasAwaitingApproval: true,
        hasSquareDraft: true,
        estimateSent: true,
      })
    ).toBe("awaiting_approval");
  });

  it("does not change invoiced or paid", () => {
    expect(
      stageAfterJobApprovals({
        current: "paid",
        hasPublishableLines: true,
        hasAwaitingApproval: false,
        hasSquareDraft: true,
        estimateSent: true,
      })
    ).toBe("paid");
  });
});
