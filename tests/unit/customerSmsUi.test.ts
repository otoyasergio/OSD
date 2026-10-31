import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/work_orders/communication-actions", () => ({
  sendMessageAction: vi.fn(),
}));
vi.mock("@/app/(app)/work_orders/square-actions", () => ({
  cancelSquareInvoiceAction: vi.fn(),
  publishSquareBalanceAction: vi.fn(),
  publishSquareInvoiceAction: vi.fn(),
  sendEstimateApprovalAction: vi.fn(),
  syncSquareDraftAction: vi.fn(),
}));

import { SendMessagePanel } from "@/components/communications/SendMessagePanel";
import { SquareInvoicePanel } from "@/components/square/SquareInvoicePanel";

function smsOption(html: string): string {
  return html.match(/<option value="sms"[^>]*>SMS<\/option>/)?.[0] ?? "";
}

describe("staff SMS controls", () => {
  it("keeps SendMessagePanel SMS selected and enabled for a valid opted-out phone", () => {
    const html = renderToStaticMarkup(
      createElement(SendMessagePanel, {
        workOrderId: "wo-1",
        logs: [],
        canSend: true,
        customerPhone: "(647) 555-0100",
        smsOptedOut: true,
      })
    );

    expect(smsOption(html)).toContain('selected=""');
    expect(smsOption(html)).not.toContain("disabled");
    expect(html).toMatch(/Wix Inbox|Wix Contacts/i);
    expect(html).not.toMatch(/\bSTART\b/);
    const sendButton = html.match(/<button[^>]*>Send<\/button>/)?.[0] ?? "";
    expect(sendButton).toMatch(/^<button/);
    expect(sendButton).not.toContain("disabled");
  });

  it("keeps Square approval SMS selected and enabled for a valid opted-out phone", () => {
    const html = renderToStaticMarkup(
      createElement(SquareInvoicePanel, {
        workOrderId: "wo-1",
        squareInvoiceId: null,
        squarePaymentStatus: null,
        squareInvoicePublicUrl: null,
        billingStage: "draft",
        billingCollectedCents: 0,
        estimateSubtotalCents: 10000,
        estimateHstCents: 1300,
        estimateTotalCents: 11300,
        canManage: true,
        customerPhone: "(647) 555-0100",
        customerEmail: "ada@example.com",
        smsOptedOut: true,
      })
    );

    expect(smsOption(html)).toContain('selected=""');
    expect(smsOption(html)).not.toContain("disabled");
    expect(html).toMatch(/Wix Inbox|Wix Contacts/i);
    expect(html).not.toMatch(/\bSTART\b/);
    const sendButton = html.match(/<button[^>]*>Send for approval<\/button>/)?.[0] ?? "";
    expect(sendButton).toMatch(/^<button/);
    expect(sendButton).not.toContain("disabled");
  });
});
