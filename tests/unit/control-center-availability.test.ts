import { describe, expect, it } from "vitest";
import { deriveTechAvailability } from "@/lib/control-center/availability";

describe("deriveTechAvailability", () => {
  it("is off when not clocked in", () => {
    expect(deriveTechAvailability({ clockedIn: false, activeAssignedJobCount: 2 })).toBe(
      "off"
    );
  });

  it("is busy when clocked in with active assigned jobs", () => {
    expect(deriveTechAvailability({ clockedIn: true, activeAssignedJobCount: 1 })).toBe(
      "busy"
    );
  });

  it("is available when clocked in with no active assigned jobs", () => {
    expect(deriveTechAvailability({ clockedIn: true, activeAssignedJobCount: 0 })).toBe(
      "available"
    );
  });
});
