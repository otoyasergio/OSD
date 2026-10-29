import { describe, expect, it } from "vitest";
import {
  buildTabBarItems,
  isTabSelected,
  type TabBarItem,
} from "@/lib/navigation/tabBar";

function hrefs(items: TabBarItem[]) {
  return items.map((item) => (item.kind === "link" ? item.href : item.id));
}

describe("buildTabBarItems", () => {
  it("keeps front-office tabs at or under Apple's 5-item limit", () => {
    for (const role of ["owner", "manager", "service_advisor", "admin"] as const) {
      const items = buildTabBarItems(role);
      expect(items.length).toBeGreaterThanOrEqual(3);
      expect(items.length).toBeLessThanOrEqual(5);
      expect(items.at(-1)).toMatchObject({ id: "more", kind: "more" });
    }
  });

  it("gives front office Home, Orders, Customers, Messages, More", () => {
    expect(hrefs(buildTabBarItems("owner"))).toEqual([
      "/dashboard",
      "/work_orders",
      "/customers",
      "/messages",
      "more",
    ]);
  });

  it("gives floor techs Floor, Parts, Messages, More", () => {
    expect(hrefs(buildTabBarItems("technician"))).toEqual([
      "/technician",
      "/parts",
      "/messages",
      "more",
    ]);
    expect(hrefs(buildTabBarItems("head_tech"))).toEqual([
      "/technician",
      "/parts",
      "/messages",
      "more",
    ]);
  });

  it("does not put Settings or Billing on the tab bar", () => {
    for (const role of [
      "owner",
      "manager",
      "service_advisor",
      "technician",
      "head_tech",
      "admin",
    ] as const) {
      const items = hrefs(buildTabBarItems(role));
      expect(items).not.toContain("/settings");
      expect(items).not.toContain("/billing");
    }
  });
});

describe("isTabSelected", () => {
  const ownerTabs = buildTabBarItems("owner");

  it("selects the matching primary tab and not More", () => {
    const orders = ownerTabs.find((item) => item.id === "orders")!;
    const more = ownerTabs.find((item) => item.id === "more")!;
    expect(isTabSelected("/work_orders/abc", orders, ownerTabs, false)).toBe(true);
    expect(isTabSelected("/work_orders/abc", more, ownerTabs, false)).toBe(false);
  });

  it("selects More on overflow destinations", () => {
    const more = ownerTabs.find((item) => item.id === "more")!;
    const home = ownerTabs.find((item) => item.id === "home")!;
    expect(isTabSelected("/settings/users", more, ownerTabs, false)).toBe(true);
    expect(isTabSelected("/settings/users", home, ownerTabs, false)).toBe(false);
  });

  it("selects only More while the overflow sheet is open", () => {
    const more = ownerTabs.find((item) => item.id === "more")!;
    const home = ownerTabs.find((item) => item.id === "home")!;
    expect(isTabSelected("/dashboard", more, ownerTabs, true)).toBe(true);
    expect(isTabSelected("/dashboard", home, ownerTabs, true)).toBe(false);
  });

  it("uses exact matching for the floor tab", () => {
    const techTabs = buildTabBarItems("technician");
    const floor = techTabs.find((item) => item.id === "floor")!;
    const more = techTabs.find((item) => item.id === "more")!;
    expect(isTabSelected("/technician", floor, techTabs, false)).toBe(true);
    expect(isTabSelected("/technician/docket", floor, techTabs, false)).toBe(false);
    expect(isTabSelected("/technician/docket", more, techTabs, false)).toBe(true);
  });
});
