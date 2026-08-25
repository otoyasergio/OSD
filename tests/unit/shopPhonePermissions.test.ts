import { describe, expect, it } from "vitest";
import { canUseShopPhone } from "@/lib/permissions/checks";

describe("canUseShopPhone", () => {
  it("allows owner, manager, and service advisor only", () => {
    expect(canUseShopPhone("owner")).toBe(true);
    expect(canUseShopPhone("manager")).toBe(true);
    expect(canUseShopPhone("service_advisor")).toBe(true);
  });

  it("blocks technicians, head tech, admin, and the kiosk", () => {
    expect(canUseShopPhone("technician")).toBe(false);
    expect(canUseShopPhone("head_tech")).toBe(false);
    expect(canUseShopPhone("admin")).toBe(false);
    expect(canUseShopPhone("time_clock_kiosk")).toBe(false);
  });
});
