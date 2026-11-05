import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  buildStoredAuctionGuide,
  presentAuctionPriceGuide,
} from "@/lib/auctions/summary";
import type { AuctionLotRecord } from "@/lib/auctions/types";
import type { PortalWorkOrderView } from "@/lib/services/portal";

vi.mock("@/app/c/[token]/actions", () => ({
  portalApproveJobAction: vi.fn(),
  portalConfirmEstimateAction: vi.fn(),
  portalDeclineJobAction: vi.fn(),
  portalSignContractAction: vi.fn(),
  portalAckInspectionAction: vi.fn(),
}));

import { PortalClient } from "@/components/portal/PortalClient";

function lot(title: string, priceUsd: number, saleDate: string): AuctionLotRecord {
  return {
    source: "altfndata",
    sourceLotId: title,
    title,
    make: "Harley-Davidson",
    model: "Iron 883",
    modelYear: 2019,
    vendor: "Mecum",
    saleDate,
    status: "sold",
    priceUsd,
    hammerAmount: priceUsd,
    hammerCurrency: "USD",
    location: "Las Vegas",
    country: "United States",
    lotUrl: `https://example.com/${title}`,
  };
}

const guide = presentAuctionPriceGuide(
  buildStoredAuctionGuide({
    bike: { year: 2019, make: "Harley-Davidson", model: "Iron 883" },
    lots: [lot("early", 4000, "2022-01-03"), lot("late", 8000, "2024-06-03")],
    truncated: false,
    altfnConfigured: true,
    providerMessage: null,
    fetchedAt: null,
    providerFailed: false,
    cadPerUsd: () => 1,
    fx: { source: "bank-of-canada", label: "the Bank of Canada rate on each sale date" },
  }),
  "customer"
);

function view(showShopPrices: boolean): PortalWorkOrderView {
  return {
    work_order_id: "wo-1",
    work_order_number: "WO-100",
    status: "ready_for_pickup",
    customer: { first_name: "Ada", last_name: "Lovelace" },
    motorcycle_id: "bike-1",
    motorcycle: { year: 2019, make: "Harley-Davidson", model: "Iron 883" },
    jobs: [
      {
        job_id: "job-1",
        name_snapshot: "Oil change",
        status: "completed",
        standard_price_snapshot: 120,
        require_approval: false,
      },
    ],
    parts: [
      {
        part_name: "Oil filter",
        quantity: 1,
        unit_price: 25,
        job_name: "Oil change",
      },
    ],
    square_invoice_id: null,
    square_payment_status: "unpaid",
    wix_invoice: {
      displayNumber: "INV-9",
      statusLabel: "Due",
      payUrl: "https://pay.example/inv-9",
      totalCents: 16385,
    },
    show_shop_prices: showShopPrices,
    can_decide_estimate: showShopPrices,
    can_sign_contract: false,
    has_signed_contract: true,
    inspection_completed: true,
    has_inspection_ack: false,
  } as PortalWorkOrderView;
}

function renderPortal(showShopPrices: boolean): string {
  return renderToStaticMarkup(
    createElement(PortalClient, {
      token: "token",
      view: view(showShopPrices),
      contractTemplate: null,
      estimate: null,
      auctionGuide: guide,
    })
  );
}

describe("ready portal", () => {
  it("keeps auction prices, bike valuation, and a price history line", () => {
    const html = renderPortal(false);

    expect(html).toContain("Bike valuation");
    expect(html).toContain("Auction prices");
    expect(html).toContain("Price history");
    expect(html).toContain("Year of sale");
    expect(html).toContain("Median price (CAD)");
    expect(html).toContain("<polyline");
    expect(html).toContain("$4,000");
    expect(html).toContain("$8,000");
    expect(html).not.toContain("Estimate summary");
    expect(html).not.toContain("Inspection acknowledgement");
    expect(html).not.toContain("Oil change");
    expect(html).not.toContain("Oil filter");
    expect(html).not.toContain("$120.00");
    expect(html).not.toContain("$25.00");
    expect(html).not.toContain("HST");
    expect(html).not.toContain("Pay this invoice");
    expect(html).not.toContain("INV-9");

    const points = html.match(/points="([^"]+)"/)?.[1]?.split(" ") ?? [];
    expect(points.length).toBeGreaterThan(1);
    const ys = points.map((point) => Number(point.split(",")[1]));
    expect(ys[ys.length - 1]).toBeLessThan(ys[0]);
  });

  it("still shows the estimate summary when the link is allowed to include shop prices", () => {
    const html = renderPortal(true);
    expect(html).toContain("Estimate summary");
    expect(html).toContain("Oil change");
    expect(html).toContain("$120.00");
    expect(html).toContain("HST");
    expect(html).not.toContain("Inspection acknowledgement");
  });
});
