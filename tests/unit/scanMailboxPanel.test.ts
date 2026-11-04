import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScanMailboxPanel, scanMailboxNotice } from "@/components/settings/ScanMailboxPanel";

describe("scanMailboxNotice", () => {
  it("says the connected mailbox receives scan reports", () => {
    expect(scanMailboxNotice("connected")).toMatch(/scan reports/i);
    expect(scanMailboxNotice("customer_mailbox")).toMatch(/customer email/i);
    expect(scanMailboxNotice(undefined)).toBeNull();
  });
});

describe("ScanMailboxPanel", () => {
  it("tells the owner to connect a mailbox that is not the customer inbox", () => {
    const html = renderToStaticMarkup(
      createElement(ScanMailboxPanel, {
        oauthConfigured: true,
        locationAllowed: true,
        emailAddress: null,
        reports: [],
        notice: null,
        disconnectAction: async () => {},
      })
    );

    expect(html).toContain("/api/google/scan-mail/start");
    expect(html).toContain("scans@torontomoto.com");
    expect(html).toMatch(/Customers do not receive/i);
    expect(html).not.toContain("Ready for pickup");
  });

  it("shows the connected address for TopGuru and a filed report", () => {
    const html = renderToStaticMarkup(
      createElement(ScanMailboxPanel, {
        oauthConfigured: true,
        locationAllowed: true,
        emailAddress: "scans@torontomoto.com",
        reports: [
          {
            subject: "TopScan report",
            outcome: "codes",
            workOrderNumber: "WO-1042",
          },
        ],
        notice: scanMailboxNotice("connected"),
        disconnectAction: async () => {},
      })
    );

    expect(html).toContain("scans@torontomoto.com");
    expect(html).toContain("TopScan report");
    expect(html).toContain("WO-1042");
    expect(html).toContain("Disconnect");
  });
});
