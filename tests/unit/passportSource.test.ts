import { describe, expect, it } from "vitest";
import {
  collectPassportSensitiveValues,
  generatePassportNumber,
} from "@/lib/passport/source";

describe("generatePassportNumber", () => {
  it("creates a non-secret human-readable passport reference", () => {
    expect(generatePassportNumber()).toMatch(/^OTO-[A-Z0-9]{8}$/);
  });
});

describe("collectPassportSensitiveValues", () => {
  it("collects prior-owner identity and contact values without empty entries", () => {
    expect(
      collectPassportSensitiveValues([
        {
          first_name: "Previous",
          last_name: "Owner",
          phone: "647-555-0199",
          email: "previous-owner@example.com",
          address: "1 Old Street, Toronto, ON",
        },
        {
          first_name: "New",
          last_name: "Owner",
          phone: null,
          email: null,
          address: null,
        },
      ])
    ).toEqual([
      "Previous Owner",
      "Previous",
      "Owner",
      "647-555-0199",
      "previous-owner@example.com",
      "1 Old Street, Toronto, ON",
      "New Owner",
      "New",
    ]);
  });

  it("deduplicates matching values case-insensitively", () => {
    expect(
      collectPassportSensitiveValues([
        {
          first_name: "Alex",
          last_name: "Rider",
          phone: "647-555-0199",
          email: "ALEX@EXAMPLE.COM",
          address: null,
        },
        {
          first_name: "Alex",
          last_name: "Rider",
          phone: "647-555-0199",
          email: "alex@example.com",
          address: null,
        },
      ])
    ).toEqual(["Alex Rider", "Alex", "Rider", "647-555-0199", "ALEX@EXAMPLE.COM"]);
  });
});
