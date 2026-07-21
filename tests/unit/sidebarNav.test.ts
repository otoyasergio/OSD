import { describe, expect, it } from "vitest";
import { buildNavCategories, isActiveNavPath } from "@/components/layout/SidebarNav";

describe("buildNavCategories", () => {
  it("orders owner nav Finances → Workshop → Docket → Communication → Settings", () => {
    const categories = buildNavCategories("owner");
    expect(categories.map((c) => c.id)).toEqual([
      "finances",
      "workshop",
      "docket",
      "communication",
      "settings",
    ]);
    expect(categories.find((c) => c.id === "workshop")?.label).toBe("Workshop");
    expect(
      categories
        .find((c) => c.id === "workshop")
        ?.subgroups.some((g) => g.heading === "Shop floor")
    ).toBe(false);
    const communication = categories.find((c) => c.id === "communication");
    expect(communication?.subgroups.flatMap((g) => g.links).map((l) => l.href)).toEqual([
      "/messages",
    ]);
  });

  it("puts Tech Floor and Timesheets under Docket for owner/manager", () => {
    const owner = buildNavCategories("owner");
    const docket = owner.find((c) => c.id === "docket");
    expect(docket?.subgroups.flatMap((g) => g.links).map((l) => l.href)).toEqual(
      expect.arrayContaining([
        "/technician",
        "/technician/docket",
        "/settings/timesheets",
      ])
    );
    expect(docket?.subgroups.flatMap((g) => g.links).map((l) => l.label)).toEqual(
      expect.arrayContaining(["Tech Floor", "Assign docket"])
    );

    const tech = buildNavCategories("technician");
    const techDocket = tech.find((c) => c.id === "docket");
    expect(techDocket?.subgroups.flatMap((g) => g.links).map((l) => l.href)).toEqual([
      "/technician",
    ]);
    expect(techDocket?.subgroups.flatMap((g) => g.links).map((l) => l.label)).toEqual([
      "Tech Floor",
    ]);
  });

  it("labels /technician as Tech Floor (never Jobs) for every role", () => {
    for (const role of [
      "owner",
      "manager",
      "service_advisor",
      "technician",
      "head_tech",
      "admin",
    ] as const) {
      const links = buildNavCategories(role).flatMap((c) =>
        c.subgroups.flatMap((g) => g.links)
      );
      const techFloor = links.find((l) => l.href === "/technician");
      expect(techFloor?.label).toBe("Tech Floor");
      expect(links.map((l) => l.label)).not.toContain("Jobs");
    }
  });

  it("exposes Assign docket under Docket for front office only", () => {
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

  it("hides Finances (Billing and Complete and filed) from floor techs", () => {
    for (const role of ["technician", "head_tech"] as const) {
      const categories = buildNavCategories(role);
      expect(categories.map((c) => c.id)).not.toContain("finances");
      const hrefs = categories.flatMap((c) =>
        c.subgroups.flatMap((g) => g.links.map((l) => l.href))
      );
      expect(hrefs).not.toContain("/billing");
      expect(hrefs).not.toContain("/complete");
    }

    const owner = buildNavCategories("owner");
    expect(owner.map((c) => c.id)).toContain("finances");
    const ownerHrefs = owner.flatMap((c) =>
      c.subgroups.flatMap((g) => g.links.map((l) => l.href))
    );
    expect(ownerHrefs).toContain("/billing");
    expect(ownerHrefs).toContain("/complete");
  });

  it("hides Dashboard from floor techs and keeps it for front office", () => {
    for (const role of ["technician", "head_tech"] as const) {
      const hrefs = buildNavCategories(role).flatMap((c) =>
        c.subgroups.flatMap((g) => g.links.map((l) => l.href))
      );
      expect(hrefs).not.toContain("/dashboard");
    }
    for (const role of ["owner", "manager", "service_advisor"] as const) {
      const hrefs = buildNavCategories(role).flatMap((c) =>
        c.subgroups.flatMap((g) => g.links.map((l) => l.href))
      );
      expect(hrefs).toContain("/dashboard");
    }
  });

  it("hides Work Orders from floor techs and keeps it for front office", () => {
    for (const role of ["technician", "head_tech"] as const) {
      const hrefs = buildNavCategories(role).flatMap((c) =>
        c.subgroups.flatMap((g) => g.links.map((l) => l.href))
      );
      expect(hrefs).not.toContain("/work_orders");
    }
    for (const role of ["owner", "manager", "service_advisor", "admin"] as const) {
      const hrefs = buildNavCategories(role).flatMap((c) =>
        c.subgroups.flatMap((g) => g.links.map((l) => l.href))
      );
      expect(hrefs).toContain("/work_orders");
    }
  });

  it("exposes Time clock under Docket only for owner/manager (self-clock)", () => {
    for (const role of ["owner", "manager"] as const) {
      const docket = buildNavCategories(role).find((c) => c.id === "docket");
      expect(docket?.subgroups.flatMap((g) => g.links).map((l) => l.href)).toEqual(
        expect.arrayContaining(["/technician", "/technician/clock"])
      );
    }
    for (const role of ["service_advisor", "technician", "head_tech", "admin"] as const) {
      const hrefs = buildNavCategories(role).flatMap((c) =>
        c.subgroups.flatMap((g) => g.links.map((l) => l.href))
      );
      expect(hrefs).toContain("/technician");
      expect(hrefs).not.toContain("/technician/clock");
    }
  });

  it("activates Tech Floor only on the exact /technician path", () => {
    expect(isActiveNavPath("/technician", "/technician")).toBe(true);
    expect(isActiveNavPath("/technician/docket", "/technician")).toBe(false);
    expect(isActiveNavPath("/technician/clock", "/technician")).toBe(false);

    // Sibling links keep their own prefix matching.
    expect(isActiveNavPath("/technician/docket", "/technician/docket")).toBe(true);
    expect(isActiveNavPath("/technician/clock", "/technician/clock")).toBe(true);
  });

  it("keeps prefix matching for non-exclusive nav paths", () => {
    expect(isActiveNavPath("/work_orders/abc", "/work_orders")).toBe(true);
    expect(isActiveNavPath("/settings/users", "/settings/users")).toBe(true);
    expect(isActiveNavPath("/settings/users", "/settings")).toBe(false);
    expect(isActiveNavPath("/settings", "/settings")).toBe(true);
  });

  it("does not expose Password as a sidebar nav item for any role", () => {
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
      const hrefs = categories.flatMap((c) =>
        c.subgroups.flatMap((g) => g.links.map((l) => l.href))
      );
      expect(hrefs).not.toContain("/settings/password");
      expect(settings?.subgroups.find((g) => g.heading === "Account")).toBeUndefined();
      expect(settings?.subgroups.flatMap((g) => g.links).map((l) => l.href)).toContain(
        "/settings"
      );
    }
  });
});
