import { describe, expect, it } from "vitest";
import { canUseMessenger, canManageGroupMembers } from "@/lib/permissions/checks";

describe("canUseMessenger", () => {
  it("allows every active staff role except the kiosk tablet", () => {
    for (const role of [
      "owner",
      "manager",
      "service_advisor",
      "technician",
      "head_tech",
      "admin",
    ] as const) {
      expect(canUseMessenger(role)).toBe(true);
    }
    expect(canUseMessenger("time_clock_kiosk")).toBe(false);
  });
});

describe("canManageGroupMembers", () => {
  it("allows the creator regardless of role", () => {
    expect(canManageGroupMembers("technician", true)).toBe(true);
  });
  it("allows owners/managers even if not the creator", () => {
    expect(canManageGroupMembers("manager", false)).toBe(true);
    expect(canManageGroupMembers("technician", false)).toBe(false);
  });
});
