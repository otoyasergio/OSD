import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InspectionScanSection } from "@/components/inspections/InspectionScanSection";
import type { InspectionScanView } from "@/lib/email/scanReport";
import { formatMileage } from "@/lib/mileage/format";

const noop = async () => ({ error: null });

function scan(overrides: Partial<InspectionScanView>): InspectionScanView {
  return {
    scanReportId: "s1111111-1111-4111-8111-111111111111",
    outcome: "codes",
    codes: [{ code: "P0301", description: "Misfire detected" }],
    vin: "1HD1BJY174Y023456",
    reportText: "VIN 1HD1BJY174Y023456\nP0301 Misfire detected",
    mileageChoice: null,
    ...overrides,
  };
}

function html(overrides: Partial<InspectionScanView> | null, extra?: {
  readOnly?: boolean;
  mileage?: number | null;
  mileageUnit?: "km" | "mi";
  workOrderVin?: string | null;
}) {
  return renderToStaticMarkup(
    createElement(InspectionScanSection, {
      workOrderVin: extra?.workOrderVin ?? "1HD1BJY174Y023456",
      mileage: extra?.mileage === undefined ? 12000 : extra.mileage,
      mileageUnit: extra?.mileageUnit ?? "km",
      scan: overrides ? scan(overrides) : null,
      readOnly: extra?.readOnly ?? false,
      pasteAction: noop,
      noConnectionAction: noop,
      confirmAction: noop,
      mileageAction: noop,
    })
  );
}

describe("InspectionScanSection", () => {
  it("shows each code and tells the tech to leave Clear DTCs alone", () => {
    const markup = html({});
    expect(markup).toContain("P0301 Misfire detected");
    expect(markup).toContain("leave Clear DTCs alone");
    expect(markup).toContain("Paste the TopGuru report");
  });

  it("shows the clean-scan sentence", () => {
    const markup = html({ outcome: "no_codes", codes: [], reportText: "No fault codes" });
    expect(markup).toContain("No fault codes were found.");
  });

  it("shows the failed-connection sentence", () => {
    const markup = html({
      outcome: "no_connection",
      codes: [],
      reportText: "Unable to connect",
    });
    expect(markup).toContain("No connection established with the bike.");
  });

  it("notes a VIN that does not match the work order", () => {
    const markup = html(
      { vin: "JH2SC5912KK123456" },
      { workOrderVin: "1HD1BJY174Y023456" }
    );
    expect(markup).toContain("The report VIN does not match this work order.");
  });

  it("lets the tech choose a mileage that disagrees", () => {
    const markup = html(
      { reportText: "Odometer: 18,000 km\nP0301 Misfire detected" },
      { mileage: 12000, mileageUnit: "km" }
    );
    expect(markup).toContain(`Use ${formatMileage(18000, "km")}`);
    expect(markup).toContain(`Keep ${formatMileage(12000, "km")}`);
  });

  it("shows the saved text when the report needs a look", () => {
    const markup = html({
      outcome: "needs_confirmation",
      codes: [],
      reportText: "Diagnostic report attached.",
    });
    expect(markup).toContain("Diagnostic report attached.");
    expect(markup).toContain("No fault codes were found.");
    expect(markup).toContain("No connection established with the bike.");
  });

  it("hides paste and choices after the inspection is signed", () => {
    const markup = html({ outcome: "no_codes", codes: [] }, { readOnly: true });
    expect(markup).toContain("No fault codes were found.");
    expect(markup).not.toContain("Paste the TopGuru report");
    expect(markup).not.toContain("Mark no connection");
  });
});
