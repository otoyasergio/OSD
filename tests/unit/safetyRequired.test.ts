import { describe, expect, it } from "vitest";
import { isSafetyRequired } from "@/lib/status/safetyRequired";

describe("isSafetyRequired", () => {
  it("is false when waived even with Safety Inspection job", () => {
    expect(
      isSafetyRequired({
        safety_required: null,
        safety_waived: true,
        jobs: [{ status: "completed", service_name_snapshot: "Safety Inspection" }],
      })
    ).toBe(false);
  });

  it("is true when forced even without Safety Inspection job", () => {
    expect(
      isSafetyRequired({
        safety_required: true,
        safety_waived: false,
        jobs: [{ status: "completed", service_name_snapshot: "Oil Change" }],
      })
    ).toBe(true);
  });

  it("derives from active Safety Inspection job by default", () => {
    expect(
      isSafetyRequired({
        safety_required: null,
        safety_waived: false,
        jobs: [
          { status: "completed", service_name_snapshot: "Oil Change" },
          { status: "completed", service_name_snapshot: "Safety Inspection" },
        ],
      })
    ).toBe(true);
  });

  it("ignores cancelled or declined Safety Inspection jobs", () => {
    expect(
      isSafetyRequired({
        safety_required: null,
        safety_waived: false,
        jobs: [{ status: "cancelled", service_name_snapshot: "Safety Inspection" }],
      })
    ).toBe(false);
  });
});
