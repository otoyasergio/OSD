import { describe, expect, it } from "vitest";
import { canClockStaff } from "@/lib/permissions";

describe("canClockStaff", () => {
  it("allows owner, manager, service advisor, and admin", () => {
    expect(canClockStaff("owner")).toBe(true);
    expect(canClockStaff("manager")).toBe(true);
    expect(canClockStaff("service_advisor")).toBe(true);
    expect(canClockStaff("admin")).toBe(true);
  });

  it("denies floor techs", () => {
    expect(canClockStaff("technician")).toBe(false);
    expect(canClockStaff("head_tech")).toBe(false);
  });
});
