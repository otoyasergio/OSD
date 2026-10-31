import { readFileSync } from "node:fs";
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

function emailOption(html: string): string {
  return html.match(/<option value="email"[^>]*>Email<\/option>/)?.[0] ?? "";
}

function noChannelOption(html: string): string {
  return html.match(/<option value=""[^>]*>No channel available<\/option>/)?.[0] ?? "";
}

describe("staff SMS controls", () => {
  it("states authoritative consent and Wix-only reply ownership on shared panels", () => {
    const messagePanel = renderToStaticMarkup(
      createElement(SendMessagePanel, {
        workOrderId: "wo-1",
        logs: [],
        canSend: true,
        customerPhone: "(647) 555-0100",
        customerEmail: "ada@example.com",
      })
    );
    const squarePanel = renderToStaticMarkup(
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
      })
    );

    for (const html of [messagePanel, squarePanel]) {
      expect(html).toMatch(/Wix Contacts.*authoritative/i);
      expect(html).toMatch(/replies.*only.*Wix Inbox/i);
    }
  });

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

  it("disables Square approval when neither customer channel is available", () => {
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
        customerPhone: null,
        customerEmail: null,
      })
    );

    const sendButton = html.match(/<button[^>]*>Send for approval<\/button>/)?.[0] ?? "";
    expect(sendButton).toContain("disabled");
    expect(noChannelOption(html)).toContain('selected=""');
  });

  it("falls back to email in SendMessagePanel when SMS is initially unavailable", () => {
    const html = renderToStaticMarkup(
      createElement(SendMessagePanel, {
        workOrderId: "wo-1",
        logs: [],
        canSend: true,
        customerPhone: null,
        customerEmail: "ada@example.com",
      })
    );

    expect(smsOption(html)).toContain("disabled");
    expect(emailOption(html)).toContain('selected=""');
    const sendButton = html.match(/<button[^>]*>Send<\/button>/)?.[0] ?? "";
    expect(sendButton).not.toContain("disabled");
  });

  it("shows no channel and disables SendMessagePanel when no address is available", () => {
    const html = renderToStaticMarkup(
      createElement(SendMessagePanel, {
        workOrderId: "wo-1",
        logs: [],
        canSend: true,
        customerPhone: null,
        customerEmail: null,
      })
    );

    expect(noChannelOption(html)).toContain('selected=""');
    const sendButton = html.match(/<button[^>]*>Send<\/button>/)?.[0] ?? "";
    expect(sendButton).toContain("disabled");
  });

  it("passes the work-order customer email into SendMessagePanel", () => {
    const pageSource = readFileSync(
      "app/(app)/work_orders/[work_order_id]/page.tsx",
      "utf8"
    );
    const panel = pageSource.match(/<SendMessagePanel[\s\S]*?\/>/)?.[0] ?? "";

    expect(panel).toContain("customerEmail={detail.customer?.email ?? null}");
  });
});
