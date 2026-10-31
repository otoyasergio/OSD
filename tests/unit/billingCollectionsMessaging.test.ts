// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BillingBoardItem } from "@/lib/services/billingBoard";

const {
  sendMessageAction,
  sendEstimateApprovalAction,
  syncSquareDraftAction,
  publishSquareInvoiceAction,
  publishSquareBalanceAction,
} = vi.hoisted(() => ({
  sendMessageAction: vi.fn(),
  sendEstimateApprovalAction: vi.fn(),
  syncSquareDraftAction: vi.fn(),
  publishSquareInvoiceAction: vi.fn(),
  publishSquareBalanceAction: vi.fn(),
}));

vi.mock("@/app/(app)/work_orders/communication-actions", () => ({
  sendMessageAction,
}));
vi.mock("@/app/(app)/work_orders/square-actions", () => ({
  sendEstimateApprovalAction,
  syncSquareDraftAction,
  publishSquareInvoiceAction,
  publishSquareBalanceAction,
}));

import { BillingCollectionsBoard } from "@/components/billing/BillingCollectionsBoard";

function item(
  bucket: BillingBoardItem["bucket"],
  overrides: Partial<BillingBoardItem> = {}
): BillingBoardItem {
  return {
    work_order_id: `wo-${bucket}`,
    work_order_number: "WO-100",
    status: "new",
    billing_stage: bucket === "awaiting_approval" ? "awaiting_approval" : "invoiced",
    square_invoice_id: null,
    square_payment_status: null,
    square_invoice_public_url: null,
    billing_collected_cents: 0,
    billing_amount_cents: null,
    estimate_cents: 10_000,
    remaining_cents: 10_000,
    bucket,
    estimate_sent_at: null,
    invoice_published_at: null,
    customer_label: "Ada Lovelace",
    customer_phone: "6475550100",
    customer_email: "ada@example.com",
    sms_opted_out: false,
    motorcycle_label: "2020 Honda CB500F",
    href: `/work_orders/wo-${bucket}`,
    ...overrides,
  };
}

describe("BillingCollectionsBoard messaging", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    sendMessageAction.mockResolvedValue({ error: null });
    sendEstimateApprovalAction.mockResolvedValue({ error: null, sent: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function renderAndClick(boardItem: BillingBoardItem) {
    await act(async () => {
      root.render(createElement(BillingCollectionsBoard, { items: [boardItem] }));
    });
    const button = Array.from(container.querySelectorAll("button")).find((candidate) =>
      candidate.textContent?.match(/approve|approval|remind|reminder/i)
    );
    expect(button).toBeDefined();
    await act(async () => {
      button?.click();
      await Promise.resolve();
    });
  }

  it("sends only an approval request for awaiting approval", async () => {
    await renderAndClick(item("awaiting_approval"));

    expect(sendEstimateApprovalAction).toHaveBeenCalledWith(
      "wo-awaiting_approval",
      "sms"
    );
    expect(sendMessageAction).not.toHaveBeenCalled();
  });

  it.each(["unpaid", "balance_due"] as const)(
    "sends only a payment reminder for %s",
    async (bucket) => {
      await renderAndClick(item(bucket));

      expect(sendMessageAction).toHaveBeenCalledWith(
        `wo-${bucket}`,
        "payment_reminder",
        "sms"
      );
      expect(sendEstimateApprovalAction).not.toHaveBeenCalled();
    }
  );

  it.each(["ready_to_invoice", "other"] as const)(
    "offers no reminder action for %s",
    async (bucket) => {
      await act(async () => {
        root.render(createElement(BillingCollectionsBoard, { items: [item(bucket)] }));
      });

      expect(container.textContent).not.toMatch(
        /Remind|approval request|payment reminder/i
      );
    }
  );

  it("displays a reminder failure without falling back to approval", async () => {
    sendMessageAction.mockResolvedValue({
      error: "Wix rejected the payment reminder.",
    });

    await renderAndClick(item("unpaid"));

    expect(sendEstimateApprovalAction).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Wix rejected the payment reminder.");
  });
});
