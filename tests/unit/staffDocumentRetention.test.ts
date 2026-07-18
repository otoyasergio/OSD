import { describe, expect, it } from "vitest";
import {
  computeRetentionUntil,
  isStaffDocumentCategory,
  retentionLabelForCategory,
} from "@/lib/services/staffDocumentRetention";

describe("staffDocumentRetention", () => {
  it("recognizes known categories", () => {
    expect(isStaffDocumentCategory("wage_statement")).toBe(true);
    expect(isStaffDocumentCategory("not_a_category")).toBe(false);
  });

  it("returns ESA-oriented retention labels", () => {
    expect(retentionLabelForCategory("vacation_record")).toMatch(/5 years/i);
    expect(retentionLabelForCategory("wage_statement")).toMatch(/3 years/i);
  });

  it("computes vacation retention as 5 years from createdAt", () => {
    const created = new Date("2024-01-15T12:00:00Z");
    const until = computeRetentionUntil("vacation_record", created);
    expect(until.toISOString().slice(0, 10)).toBe("2029-01-15");
  });

  it("uses employment end for employment agreements when provided", () => {
    const created = new Date("2020-01-01T12:00:00Z");
    const end = new Date("2024-06-01T12:00:00Z");
    const until = computeRetentionUntil("employment_agreement", created, {
      employmentEndDate: end,
    });
    expect(until.toISOString().slice(0, 10)).toBe("2027-06-01");
  });

  it("uses leave end for leave records when provided", () => {
    const created = new Date("2024-01-01T12:00:00Z");
    const leaveEnd = new Date("2024-03-01T12:00:00Z");
    const until = computeRetentionUntil("leave_record", created, {
      leaveEndDate: leaveEnd,
    });
    expect(until.toISOString().slice(0, 10)).toBe("2027-03-01");
  });
});
