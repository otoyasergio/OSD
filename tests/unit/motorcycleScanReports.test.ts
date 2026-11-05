import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MotorcycleScanReports } from "@/components/motorcycles/MotorcycleScanReports";
import type { BikeScanReport } from "@/lib/services/motorcycleScans";

const report: BikeScanReport = {
  scanReportId: "s1111111-1111-4111-8111-111111111111",
  receivedAt: "2026-11-04T21:50:53.000Z",
  outcome: "codes",
  codes: [{ code: "480682", description: "ABS: Pullaway assistant deactivated" }],
  reportText:
    "Distance Traveled: 51382 miles\n480682 ABS: Pullaway assistant deactivated",
  workOrderId: null,
  workOrderNumber: null,
};

describe("MotorcycleScanReports", () => {
  it("shows a report on the bike when no visit is open", () => {
    const html = renderToStaticMarkup(
      createElement(MotorcycleScanReports, { reports: [report] })
    );
    expect(html).toContain("480682 ABS: Pullaway assistant deactivated");
    expect(html).toContain("No open visit");
    expect(html).toContain("51,382 mi");
  });

  it("says when the bike has no scan reports", () => {
    const html = renderToStaticMarkup(
      createElement(MotorcycleScanReports, { reports: [] })
    );
    expect(html).toContain("No scan reports for this bike yet.");
  });
});
