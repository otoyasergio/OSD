import { describe, expect, it } from "vitest";
import { hashPassportPayload } from "@/lib/passport/digest";
import {
  PASSPORT_PUBLIC_GRANT_COLUMNS,
  PASSPORT_PUBLIC_SNAPSHOT_COLUMNS,
  resolvePassportShareRecord,
  type PassportShareDatabaseRecord,
} from "@/lib/passport/resolveShare";
import { passportSnapshotSchema } from "@/lib/passport/schema";

const payload = passportSnapshotSchema.parse({
  schema_version: 1,
  passport_number: "OTO-8H2K4M6P",
  report_version: 1,
  issued_at: "2026-10-30T18:00:00.000Z",
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
      installed_parts: [],
    },
  ],
  limitations: [
    "This passport covers the OTOMOTO records listed through the coverage date.",
  ],
});

function record(
  overrides: Partial<PassportShareDatabaseRecord> = {}
): PassportShareDatabaseRecord {
  return {
    share_id: "00000000-0000-4000-8000-000000000501",
    expires_at: "2026-11-07T02:30:00.000Z",
    revoked_at: null,
    snapshot: {
      snapshot_id: "00000000-0000-4000-8000-000000000401",
      payload,
      payload_sha256: hashPassportPayload(payload),
      superseded_at: null,
      passport_status: "active",
    },
    ...overrides,
  };
}

const NOW = new Date("2026-10-31T02:30:00.000Z");

describe("resolvePassportShareRecord", () => {
  it("limits public database reads to grants and frozen snapshot fields", () => {
    const columns = `${PASSPORT_PUBLIC_GRANT_COLUMNS},${PASSPORT_PUBLIC_SNAPSHOT_COLUMNS}`;
    expect(columns).toContain("payload");
    expect(columns).not.toMatch(
      /customer|work_order|message|billing|square|invoice|payment|phone|email|address/i
    );
  });

  it("returns only the validated frozen payload for a current grant", () => {
    expect(resolvePassportShareRecord(record(), NOW)).toEqual({
      payload,
      expiresAt: "2026-11-07T02:30:00.000Z",
    });
  });

  it("denies expired, revoked, superseded, and suspended records uniformly", () => {
    expect(
      resolvePassportShareRecord(record({ expires_at: "2026-10-30T02:30:00.000Z" }), NOW)
    ).toBeNull();
    expect(
      resolvePassportShareRecord(record({ revoked_at: "2026-10-30T02:30:00.000Z" }), NOW)
    ).toBeNull();
    expect(
      resolvePassportShareRecord(
        record({
          snapshot: {
            ...record().snapshot,
            superseded_at: "2026-10-30T02:30:00.000Z",
          },
        }),
        NOW
      )
    ).toBeNull();
    expect(
      resolvePassportShareRecord(
        record({
          snapshot: { ...record().snapshot, passport_status: "suspended" },
        }),
        NOW
      )
    ).toBeNull();
  });

  it("denies a payload whose immutable digest no longer matches", () => {
    expect(
      resolvePassportShareRecord(
        record({
          snapshot: {
            ...record().snapshot,
            payload_sha256: "0".repeat(64),
          },
        }),
        NOW
      )
    ).toBeNull();
  });

  it("denies an invalid payload even when its altered digest matches", () => {
    const unsafe = { ...payload, customer_email: "previous@example.com" };
    expect(
      resolvePassportShareRecord(
        record({
          snapshot: {
            ...record().snapshot,
            payload: unsafe,
            payload_sha256: hashPassportPayload(unsafe),
          },
        }),
        NOW
      )
    ).toBeNull();
  });
});
