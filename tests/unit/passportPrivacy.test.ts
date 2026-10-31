import { describe, expect, it } from "vitest";
import {
  passportSnapshotSchema,
  type PassportSnapshotPayload,
} from "@/lib/passport/schema";
import {
  PassportPrivacyError,
  findPassportDisclosureRisks,
  validatePassportPayload,
} from "@/lib/passport/privacy";

const VALID_PAYLOAD = {
  schema_version: 1,
  passport_number: "OTO-8H2K4M6P",
  report_version: 1,
  issued_at: "2026-10-31T02:30:00.000Z",
  coverage_through: "2026-10-30T21:00:00.000Z",
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
      service_date: "2026-10-01",
      work_order_reference: "TOR-1042",
      mileage: { value: 12_450, unit: "km" },
      location: "Toronto",
      source_label: "OTOMOTO performed",
      completed_services: ["Engine oil and filter service"],
      installed_parts: [
        {
          description: "Oil filter",
          part_number: "15410-MFJ-D02",
          quantity: 1,
        },
      ],
    },
  ],
  limitations: [
    "This passport covers the OTOMOTO records listed through the coverage date.",
    "It is not a statement of current condition or a complete lifetime history.",
  ],
} as const;

describe("passportSnapshotSchema", () => {
  it("accepts the intentionally narrow public payload", () => {
    expect(passportSnapshotSchema.parse(VALID_PAYLOAD)).toEqual(VALID_PAYLOAD);
  });

  it("rejects customer, message, and payment fields at every object boundary", () => {
    const unsafe = {
      ...VALID_PAYLOAD,
      customer_id: "00000000-0000-4000-8000-000000000001",
      service_entries: [
        {
          ...VALID_PAYLOAD.service_entries[0],
          payment_amount_cents: 12_500,
          messages: ["Your motorcycle is ready."],
        },
      ],
    };

    expect(() => passportSnapshotSchema.parse(unsafe)).toThrow();
  });
});

describe("passport privacy validation", () => {
  it("reports prior-owner contact values embedded in otherwise allowed text", () => {
    const unsafe: PassportSnapshotPayload = {
      ...passportSnapshotSchema.parse(VALID_PAYLOAD),
      service_entries: [
        {
          ...passportSnapshotSchema.parse(VALID_PAYLOAD).service_entries[0],
          completed_services: [
            "Electrical diagnosis requested by previous-owner@example.com",
          ],
        },
      ],
    };

    expect(
      findPassportDisclosureRisks(unsafe, ["previous-owner@example.com", "647-555-0199"])
    ).toContain("service_entries[0].completed_services[0]:sensitive_value");
  });

  it("rejects email addresses and phone numbers in service-facing free text", () => {
    const base = passportSnapshotSchema.parse(VALID_PAYLOAD);
    const unsafe: PassportSnapshotPayload = {
      ...base,
      service_entries: [
        {
          ...base.service_entries[0],
          completed_services: ["Call 647-555-0199 or owner@example.com"],
        },
      ],
    };

    expect(() => validatePassportPayload(unsafe)).toThrow(PassportPrivacyError);
    expect(() => validatePassportPayload(unsafe)).toThrow("PASSPORT_DISCLOSURE_RISK");
  });

  it("does not treat canonical shop contact details as prior-owner disclosure", () => {
    expect(validatePassportPayload(VALID_PAYLOAD)).toEqual(
      passportSnapshotSchema.parse(VALID_PAYLOAD)
    );
  });
});
