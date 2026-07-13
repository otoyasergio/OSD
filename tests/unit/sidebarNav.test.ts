import { describe, expect, it } from "vitest";
import { buildNavCategories } from "@/components/layout/SidebarNav";

describe("buildNavCategories", () => {
  it("orders owner nav Finances → Clients → Communication → Staffing → Settings", () => {
    const categories = buildNavCategories("owner");
    expect(categories.map((c) => c.id)).toEqual([
      "finances",
      "clients",
      "communication",
      "staffing",
      "settings",
    ]);
    const communication = categories.find((c) => c.id === "communication");
    expect(communication?.subgroups.flatMap((g) => g.links).map((l) => l.href)).toEqual([
      "/messages",
    ]);
  });

  it("puts Timesheets under Staffing for owner/manager", () => {
    const owner = buildNavCategories("owner");
    const staffing = owner.find((c) => c.id === "staffing");
    expect(staffing?.subgroups.flatMap((g) => g.links).map((l) => l.href)).toEqual(
      expect.arrayContaining([
        "/technician",
        "/technician/docket",
        "/settings/timesheets",
      ])
    );

    const tech = buildNavCategories("technician");
    const techStaffing = tech.find((c) => c.id === "staffing");
    expect(techStaffing?.subgroups.flatMap((g) => g.links).map((l) => l.href)).toEqual([
      "/technician",
    ]);
  });

  it("exposes Docket under Staffing for front office only", () => {
    for (const role of ["owner", "manager", "service_advisor"] as const) {
      const hrefs = buildNavCategories(role).flatMap((c) =>
        c.subgroups.flatMap((g) => g.links.map((l) => l.href))
      );
      expect(hrefs).toContain("/technician/docket");
    }
    for (const role of ["technician", "head_tech", "admin"] as const) {
      const hrefs = buildNavCategories(role).flatMap((c) =>
        c.subgroups.flatMap((g) => g.links.map((l) => l.href))
      );
      expect(hrefs).not.toContain("/technician/docket");
    }
  });

  it("hides Customers and Motorcycles for technicians", () => {
    const tech = buildNavCategories("technician");
    const hrefs = tech.flatMap((c) =>
      c.subgroups.flatMap((g) => g.links.map((l) => l.href))
    );
    expect(hrefs).not.toContain("/customers");
    expect(hrefs).not.toContain("/motorcycles");

    const headTech = buildNavCategories("head_tech");
    const headTechHrefs = headTech.flatMap((c) =>
      c.subgroups.flatMap((g) => g.links.map((l) => l.href))
    );
    expect(headTechHrefs).not.toContain("/customers");
    expect(headTechHrefs).not.toContain("/motorcycles");

    const owner = buildNavCategories("owner");
    const ownerHrefs = owner.flatMap((c) =>
      c.subgroups.flatMap((g) => g.links.map((l) => l.href))
    );
    expect(ownerHrefs).toContain("/customers");
    expect(ownerHrefs).toContain("/motorcycles");
  });

  it("exposes Password under Settings Account for every role including technician", () => {
    for (const role of [
      "owner",
      "manager",
      "service_advisor",
      "technician",
      "head_tech",
      "admin",
    ] as const) {
      const categories = buildNavCategories(role);
      const settings = categories.find((c) => c.id === "settings");
      const account = settings?.subgroups.find((g) => g.heading === "Account");
      expect(account?.links.map((l) => l.href)).toEqual(["/settings/password"]);
    }
  });
});
