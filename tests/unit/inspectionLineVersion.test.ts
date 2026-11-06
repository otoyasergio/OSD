import { describe, expect, it } from "vitest";
import { isSameInstant, laterLineVersion } from "@/lib/inspections/inspectionLineVersion";

describe("inspection line version", () => {
  it("treats the same instant written two ways as one version", () => {
    expect(isSameInstant("2026-11-03T12:00:00.000Z", "2026-11-03T12:00:00+00:00")).toBe(
      true
    );
    expect(isSameInstant("2026-11-03T12:00:00.000Z", "2026-11-03T12:00:00.001Z")).toBe(
      false
    );
  });

  it("falls back to the text when a version is not a date", () => {
    expect(isSameInstant("abc", "abc")).toBe(true);
    expect(isSameInstant("abc", "2026-11-03T12:00:00.000Z")).toBe(false);
  });

  it("never moves the version backwards", () => {
    const older = "2026-11-03T12:00:00.000Z";
    const newer = "2026-11-03T12:05:00.000Z";
    expect(laterLineVersion(older, newer)).toBe(newer);
    expect(laterLineVersion(newer, older)).toBe(newer);
    expect(laterLineVersion(newer, "not a date")).toBe(newer);
  });
});
