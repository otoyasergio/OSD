import { describe, expect, it } from "vitest";
import { canClockStaff } from "@/lib/permissions";

describe("canClockStaff", () => {
  it("allows owner, manager, and service advisor", () => {
    expect(canClockStaff("owner")).toBe(true);
    expect(canClockStaff("manager")).toBe(true);
    expect(canClockStaff("service_advisor")).toBe(true);
  });

  it("denies floor techs and admin", () => {
    expect(canClockStaff("technician")).toBe(false);
    expect(canClockStaff("head_tech")).toBe(false);
    expect(canClockStaff("admin")).toBe(false);
  });
});
