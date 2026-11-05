import { describe, it, expect } from "vitest";
import { createWorkOrderSchema } from "@/lib/validation/schemas";
import {
  createIntakeServiceLineDraft,
  formatServiceLineSummary,
  hasValidServiceLinePrice,
  oilChangeIncludedParts,
  readServiceLinesFromFormData,
  resolveJobSnapshots,
  serviceLineSubtotalDollars,
  tuneUpIncludedNote,
} from "@/lib/forms/serviceLines";

const SERVICE_A = "11111111-1111-4111-8111-111111111111";
const SERVICE_B = "22222222-2222-4222-8222-222222222222";
const MOTO = "33333333-3333-4333-8333-333333333333";
const LOC = "44444444-4444-4444-8444-444444444444";

describe("createIntakeServiceLineDraft", () => {
  it("starts Diagnostic at one hour and the shop hourly rate", () => {
    expect(
      createIntakeServiceLineDraft({
        name: "Diagnostic",
        estimatedLabour: 1,
        standardPrice: null,
        shopHourlyRate: 156,
      })
    ).toEqual({ note: "", labourHours: "1", price: "156" });
  });

  it("uses the owner-set shop rate instead of a hardcoded default", () => {
    expect(
      createIntakeServiceLineDraft({
        name: "Diagnostic",
        estimatedLabour: 1,
        standardPrice: null,
        shopHourlyRate: 180,
      })
    ).toEqual({ note: "", labourHours: "1", price: "180" });
  });

  it("falls back to one hour when Diagnostic has no catalogue labour", () => {
    expect(
      createIntakeServiceLineDraft({
        name: "Diagnostics",
        estimatedLabour: null,
        standardPrice: null,
        shopHourlyRate: 156,
      })
    ).toEqual({ note: "", labourHours: "1", price: "156" });
  });

  it("prices catalogue labour with no fixed price at hours × $156", () => {
    expect(
      createIntakeServiceLineDraft({
        name: "General repair",
        estimatedLabour: 2,
        standardPrice: null,
      })
    ).toEqual({ note: "", labourHours: "2", price: "312" });
  });

  it("leaves custom work blank until staff enter hours", () => {
    expect(
      createIntakeServiceLineDraft({
        name: "Custom work",
        estimatedLabour: null,
        standardPrice: null,
      })
    ).toEqual({ note: "", labourHours: "", price: "" });
  });

  it("prices an oil change at $165 and adds two $0 parts from the bike", () => {
    expect(
      createIntakeServiceLineDraft({
        name: "Oil Change",
        estimatedLabour: 1,
        standardPrice: 165,
      })
    ).toEqual({ note: "", labourHours: "", price: "165" });
    expect(oilChangeIncludedParts({ oil_filter: "HF204", oil_type: "10W-40" })).toEqual([
      { part_name: "Oil filter HF204", unit_price: 0, quantity: 1 },
      { part_name: "Oil 10W-40", unit_price: 0, quantity: 1 },
    ]);
    expect(oilChangeIncludedParts(null)).toEqual([
      { part_name: "Oil filter", unit_price: 0, quantity: 1 },
      { part_name: "Oil", unit_price: 0, quantity: 1 },
    ]);
  });

  it("prices a seasonal tune-up at $500 and notes the included parts", () => {
    const fitment = {
      oil_filter: "HF204",
      oil_type: "10W-40",
      spark_plugs: "LMAR8A-9",
      air_filter: "HFA7914",
    };
    expect(
      createIntakeServiceLineDraft({
        name: "Fall Tune Up",
        estimatedLabour: null,
        standardPrice: 500,
        fitment,
      })
    ).toEqual({
      note: tuneUpIncludedNote(fitment),
      labourHours: "",
      price: "500",
    });
    expect(tuneUpIncludedNote(fitment)).toBe(
      "Includes oil 10W-40, filter HF204, spark plug LMAR8A-9, and air filter HFA7914."
    );
    expect(
      createIntakeServiceLineDraft({
        name: "Spring/Summer Tune Up",
        estimatedLabour: null,
        standardPrice: 500,
      }).note
    ).toBe("Includes oil, filter, spark plug, and air filter.");
  });

  it("uses a fixed catalogue price when one is configured", () => {
    expect(
      createIntakeServiceLineDraft({
        name: "Diagnostic",
        estimatedLabour: 1,
        standardPrice: 160,
      })
    ).toEqual({ note: "", labourHours: "1", price: "160" });
  });
});

describe("serviceLineSubtotalDollars", () => {
  it("totals selected pre-tax service prices to the cent", () => {
    expect(
      serviceLineSubtotalDollars([
        { note: "", labourHours: "1", price: "145" },
        { note: "", labourHours: "0.5", price: "72.50" },
      ])
    ).toBe(217.5);
  });

  it("ignores blank, invalid, and negative prices", () => {
    expect(
      serviceLineSubtotalDollars([
        { note: "", labourHours: "", price: "" },
        { note: "", labourHours: "", price: "not a price" },
        { note: "", labourHours: "", price: "-10" },
        undefined,
      ])
    ).toBe(0);
  });
});

describe("hasValidServiceLinePrice", () => {
  it("accepts zero and positive prices", () => {
    expect(hasValidServiceLinePrice({ note: "", labourHours: "", price: "0" })).toBe(
      true
    );
    expect(hasValidServiceLinePrice({ note: "", labourHours: "1", price: "145" })).toBe(
      true
    );
  });

  it("rejects missing, invalid, and negative prices", () => {
    expect(hasValidServiceLinePrice(undefined)).toBe(false);
    expect(hasValidServiceLinePrice({ note: "", labourHours: "", price: "" })).toBe(
      false
    );
    expect(
      hasValidServiceLinePrice({ note: "", labourHours: "", price: "invalid" })
    ).toBe(false);
    expect(hasValidServiceLinePrice({ note: "", labourHours: "", price: "-1" })).toBe(
      false
    );
  });
});

describe("readServiceLinesFromFormData", () => {
  it("reads note, labour, and price for selected services", () => {
    const formData = new FormData();
    formData.set(`service_note_${SERVICE_A}`, "  Front pads worn  ");
    formData.set(`service_labour_${SERVICE_A}`, "1.5");
    formData.set(`service_price_${SERVICE_A}`, "189.5");
    formData.set(`service_note_${SERVICE_B}`, "");
    formData.set(`service_labour_${SERVICE_B}`, "");
    formData.set(`service_price_${SERVICE_B}`, "");

    expect(readServiceLinesFromFormData(formData, [SERVICE_A, SERVICE_B])).toEqual([
      {
        service_id: SERVICE_A,
        note: "Front pads worn",
        estimated_labour: 1.5,
        standard_price: 189.5,
      },
      {
        service_id: SERVICE_B,
        note: null,
        estimated_labour: null,
        standard_price: null,
      },
    ]);
  });

  it("treats negative numbers as missing", () => {
    const formData = new FormData();
    formData.set(`service_labour_${SERVICE_A}`, "-1");
    formData.set(`service_price_${SERVICE_A}`, "-10");

    expect(readServiceLinesFromFormData(formData, [SERVICE_A])).toEqual([
      {
        service_id: SERVICE_A,
        note: null,
        estimated_labour: null,
        standard_price: null,
      },
    ]);
  });
});

describe("resolveJobSnapshots", () => {
  it("prefers line overrides over catalogue defaults", () => {
    expect(
      resolveJobSnapshots({
        catalogueLabour: 1,
        cataloguePrice: 100,
        line: {
          service_id: SERVICE_A,
          note: "Custom",
          estimated_labour: 2.5,
          standard_price: 220,
        },
      })
    ).toEqual({
      notes: "Custom",
      estimated_labour_snapshot: 2.5,
      standard_price_snapshot: 220,
    });
  });

  it("falls back to catalogue when line overrides are null", () => {
    expect(
      resolveJobSnapshots({
        catalogueLabour: 1,
        cataloguePrice: 100,
        line: {
          service_id: SERVICE_A,
          note: null,
          estimated_labour: null,
          standard_price: null,
        },
      })
    ).toEqual({
      notes: null,
      estimated_labour_snapshot: 1,
      standard_price_snapshot: 100,
    });
  });

  it("keeps zero overrides", () => {
    expect(
      resolveJobSnapshots({
        catalogueLabour: 1,
        cataloguePrice: 100,
        line: {
          service_id: SERVICE_A,
          note: null,
          estimated_labour: 0,
          standard_price: 0,
        },
      })
    ).toEqual({
      notes: null,
      estimated_labour_snapshot: 0,
      standard_price_snapshot: 0,
    });
  });
});

describe("formatServiceLineSummary", () => {
  it("joins name with hours, price, and note", () => {
    expect(
      formatServiceLineSummary({
        name: "Oil Change",
        labourHours: "1",
        price: "89",
        note: "Use Motul 7100",
      })
    ).toBe("Oil Change · 1 h · $89 · Use Motul 7100");
  });
});

describe("createWorkOrderSchema service_lines", () => {
  const base = {
    motorcycle_id: MOTO,
    location_id: LOC,
    work_order_number: "WO-1042",
    mileage: 12000,
    estimated_completion: "2026-07-20T20:00:00.000Z",
    service_ids: [SERVICE_A],
  };

  it("requires a Wix work order number", () => {
    expect(
      createWorkOrderSchema.safeParse({ ...base, work_order_number: undefined }).success
    ).toBe(false);
    expect(
      createWorkOrderSchema.safeParse({ ...base, work_order_number: "   " }).success
    ).toBe(false);
    expect(createWorkOrderSchema.safeParse(base).success).toBe(true);
  });

  it("requires a whole, non-negative mileage reading", () => {
    expect(createWorkOrderSchema.safeParse({ ...base, mileage: undefined }).success).toBe(
      false
    );
    expect(createWorkOrderSchema.safeParse({ ...base, mileage: -1 }).success).toBe(false);
    expect(createWorkOrderSchema.safeParse({ ...base, mileage: 12.5 }).success).toBe(
      false
    );
    expect(createWorkOrderSchema.safeParse({ ...base, mileage: 0 }).success).toBe(true);
  });

  it("defaults mileage to kilometres and accepts miles", () => {
    expect(createWorkOrderSchema.parse(base).mileage_unit).toBe("km");
    expect(
      createWorkOrderSchema.parse({ ...base, mileage_unit: "mi" }).mileage_unit
    ).toBe("mi");
    expect(
      createWorkOrderSchema.safeParse({ ...base, mileage_unit: "yards" }).success
    ).toBe(false);
  });

  it("requires a valid estimated completion time", () => {
    expect(
      createWorkOrderSchema.safeParse({ ...base, estimated_completion: undefined })
        .success
    ).toBe(false);
    expect(
      createWorkOrderSchema.safeParse({ ...base, estimated_completion: "not-a-date" })
        .success
    ).toBe(false);
    expect(createWorkOrderSchema.safeParse(base).success).toBe(true);
  });

  it("requires at least one selected service", () => {
    expect(createWorkOrderSchema.safeParse({ ...base, service_ids: [] }).success).toBe(
      false
    );
    expect(createWorkOrderSchema.safeParse(base).success).toBe(true);
  });

  it("accepts valid service line overrides", () => {
    const parsed = createWorkOrderSchema.parse({
      ...base,
      service_lines: [
        {
          service_id: SERVICE_A,
          note: "Check chain",
          estimated_labour: 1.5,
          standard_price: 120,
        },
      ],
    });
    expect(parsed.service_lines[0]?.note).toBe("Check chain");
  });

  it("rejects negative labour or price", () => {
    expect(() =>
      createWorkOrderSchema.parse({
        ...base,
        service_lines: [
          {
            service_id: SERVICE_A,
            estimated_labour: -1,
          },
        ],
      })
    ).toThrow();

    expect(() =>
      createWorkOrderSchema.parse({
        ...base,
        service_lines: [
          {
            service_id: SERVICE_A,
            standard_price: -50,
          },
        ],
      })
    ).toThrow();
  });
});
