import { describe, it, expect } from "vitest";
import { createWorkOrderSchema } from "@/lib/validation/schemas";
import {
  formatServiceLineSummary,
  readServiceLinesFromFormData,
  resolveJobSnapshots,
} from "@/lib/forms/serviceLines";

const SERVICE_A = "11111111-1111-4111-8111-111111111111";
const SERVICE_B = "22222222-2222-4222-8222-222222222222";
const MOTO = "33333333-3333-4333-8333-333333333333";
const LOC = "44444444-4444-4444-8444-444444444444";

describe("readServiceLinesFromFormData", () => {
  it("reads note, labour, and price for selected services", () => {
    const formData = new FormData();
    formData.set(`service_note_${SERVICE_A}`, "  Front pads worn  ");
    formData.set(`service_labour_${SERVICE_A}`, "1.5");
    formData.set(`service_price_${SERVICE_A}`, "189.5");
    formData.set(`service_note_${SERVICE_B}`, "");
    formData.set(`service_labour_${SERVICE_B}`, "");
    formData.set(`service_price_${SERVICE_B}`, "");

    expect(
      readServiceLinesFromFormData(formData, [SERVICE_A, SERVICE_B])
    ).toEqual([
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
    mileage: 12000,
    estimated_completion: "2026-07-20T20:00:00.000Z",
    service_ids: [SERVICE_A],
  };

  it("requires a whole, non-negative mileage reading", () => {
    expect(createWorkOrderSchema.safeParse({ ...base, mileage: undefined }).success).toBe(
      false
    );
    expect(createWorkOrderSchema.safeParse({ ...base, mileage: -1 }).success).toBe(false);
    expect(createWorkOrderSchema.safeParse({ ...base, mileage: 12.5 }).success).toBe(false);
    expect(createWorkOrderSchema.safeParse({ ...base, mileage: 0 }).success).toBe(true);
  });

  it("requires a valid estimated completion time", () => {
    expect(
      createWorkOrderSchema.safeParse({ ...base, estimated_completion: undefined }).success
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
