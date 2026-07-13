import { describe, expect, it } from "vitest";
import { buildNavCategories } from "@/components/layout/SidebarNav";

describe("buildNavCategories", () => {
  it("orders owner nav Finances → Clients → Staffing → Settings and omits empty Communication", () => {
    const categories = buildNavCategories("owner");
    expect(categories.map((c) => c.id)).toEqual([
      "finances",
      "clients",
      "staffing",
      "settings",
    ]);
    expect(categories.find((c) => c.id === "communication")).toBeUndefined();
  });

  it("puts Timesheets under Staffing for owner/manager", () => {
    const owner = buildNavCategories("owner");
    const staffing = owner.find((c) => c.id === "staffing");
    expect(staffing?.subgroups.flatMap((g) => g.links).map((l) => l.href)).toEqual(
      expect.arrayContaining(["/technician", "/settings/timesheets"])
    );

    const tech = buildNavCategories("technician");
    const techStaffing = tech.find((c) => c.id === "staffing");
    expect(
      techStaffing?.subgroups.flatMap((g) => g.links).map((l) => l.href)
    ).toEqual(["/technician"]);
  });
});
