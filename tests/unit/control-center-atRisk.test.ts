import { describe, expect, it } from "vitest";
import {
  isControlCenterAtRisk,
  isJobIdleAtLeastThreeDays,
  latestJobActivityAt,
} from "@/lib/control-center/atRisk";

describe("isControlCenterAtRisk", () => {
  const now = new Date("2026-07-14T12:00:00.000Z");

  it("is at risk when overdue", () => {
    expect(
      isControlCenterAtRisk({
        overdue: true,
        safetyCritical: false,
        lastJobActivityAt: now.toISOString(),
        now,
      })
    ).toBe(true);
  });

  it("is at risk when safety-critical", () => {
    expect(
      isControlCenterAtRisk({
        overdue: false,
        safetyCritical: true,
        lastJobActivityAt: now.toISOString(),
        now,
      })
    ).toBe(true);
  });

  it("is at risk when last job activity is idle ≥ 3 days", () => {
    expect(
      isControlCenterAtRisk({
        overdue: false,
        safetyCritical: false,
        lastJobActivityAt: "2026-07-10T11:00:00.000Z",
        now,
      })
    ).toBe(true);
  });

  it("is not at risk when recently active and no flags", () => {
    expect(
      isControlCenterAtRisk({
        overdue: false,
        safetyCritical: false,
        lastJobActivityAt: "2026-07-13T12:00:00.000Z",
        now,
      })
    ).toBe(false);
  });
});

describe("isJobIdleAtLeastThreeDays", () => {
  const now = new Date("2026-07-14T12:00:00.000Z");

  it("returns false for missing activity", () => {
    expect(isJobIdleAtLeastThreeDays(null, now)).toBe(false);
  });

  it("returns false just under 3 days", () => {
    expect(isJobIdleAtLeastThreeDays("2026-07-11T12:01:00.000Z", now)).toBe(false);
  });

  it("returns true at exactly 3 days", () => {
    expect(isJobIdleAtLeastThreeDays("2026-07-11T12:00:00.000Z", now)).toBe(true);
  });
});

describe("latestJobActivityAt", () => {
  it("picks the newest valid timestamp", () => {
    expect(
      latestJobActivityAt([
        "2026-07-01T00:00:00.000Z",
        null,
        "2026-07-10T00:00:00.000Z",
        "bad",
        "2026-07-05T00:00:00.000Z",
      ])
    ).toBe("2026-07-10T00:00:00.000Z");
  });

  it("returns null when none are valid", () => {
    expect(latestJobActivityAt([null, undefined, "nope"])).toBe(null);
  });
});
