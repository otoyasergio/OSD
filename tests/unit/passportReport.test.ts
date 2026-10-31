import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PassportReport } from "@/components/passport/PassportReport";
import { passportSnapshotSchema } from "@/lib/passport/schema";

const payload = passportSnapshotSchema.parse({
  schema_version: 1,
  passport_number: "OTO-8H2K4M6P",
  report_version: 2,
  issued_at: "2026-10-31T02:30:00.000Z",
  coverage_through: "2026-10-20T18:00:00.000Z",
  issuer: {
    legal_name: "OTOMOTO TORONTO MOTO INC.",
    address: "99 River Street, Toronto, ON M5A 3P4, Canada",
    phone: "647-424-1088",
  },
  vehicle: {
    year: 2021,
    make: "Honda",
    model: "CB650R",
    vin: "MLHRC7412M5000001",
    colour: "Red",
  },
  service_entries: [
    {
      service_date: "2026-10-20",
      work_order_reference: "TOR-1043",
      mileage: { value: 12_800, unit: "km" },
      location: "Toronto",
      source_label: "OTOMOTO performed",
      completed_services: ["Chain adjustment"],
      installed_parts: [
        {
          description: "Master link",
          part_number: "DID-520VX3-ZJ",
          quantity: 1,
        },
      ],
    },
  ],
  limitations: [
    "This passport covers the OTOMOTO records listed through the coverage date.",
  ],
});

describe("PassportReport", () => {
  it("renders only the frozen service facts and sharing limitation", () => {
    const html = renderToStaticMarkup(
      createElement(PassportReport, {
        payload,
        showDownloadNotice: true,
      })
    );

    expect(html).toContain("Vehicle service passport");
    expect(html).toContain("2021 Honda CB650R");
    expect(html).toContain("Chain adjustment");
    expect(html).toContain("DID-520VX3-ZJ");
    expect(html).toContain("Downloaded or printed copies cannot be revoked");
    expect(html).not.toMatch(/customer|payment|message|invoice/i);
  });
});
