import { describe, expect, it } from "vitest";
import { canUseMessenger, canUseShopPhone } from "@/lib/permissions/checks";

describe("canUseShopPhone", () => {
  it("allows owner, manager, and service advisor", () => {
    for (const role of ["owner", "manager", "service_advisor"] as const) {
      expect(canUseShopPhone(role)).toBe(true);
    }
  });

  it("rejects technicians, head tech, admin, and the kiosk", () => {
    for (const role of [
      "technician",
      "head_tech",
      "admin",
      "time_clock_kiosk",
    ] as const) {
      expect(canUseShopPhone(role)).toBe(false);
    }
  });

  it("does not grant PSTN just because messenger is allowed", () => {
    expect(canUseMessenger("technician")).toBe(true);
    expect(canUseShopPhone("technician")).toBe(false);
    expect(canUseMessenger("admin")).toBe(true);
    expect(canUseShopPhone("admin")).toBe(false);
  });
});
