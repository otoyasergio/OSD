import { describe, expect, it } from "vitest";
import {
  groupServicesByCategory,
  SERVICE_CATEGORY_ORDER,
  UNCATEGORISED_SERVICE_GROUP,
  type Service,
} from "@/lib/services/serviceCatalogueShared";

function service(
  overrides: Partial<Service> & Pick<Service, "service_id" | "name">
): Service {
  return {
    category: null,
    standard_price: null,
    estimated_labour: null,
    active: true,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("groupServicesByCategory", () => {
  it("groups services under their category labels in shop order", () => {
    const grouped = groupServicesByCategory([
      service({ service_id: "1", name: "Oil Change", category: "Oil & Fluids" }),
      service({
        service_id: "2",
        name: "Tire Change",
        category: "Tires",
      }),
      service({
        service_id: "3",
        name: "Brake Service",
        category: "Brakes",
      }),
      service({
        service_id: "4",
        name: "Winter Storage",
        category: "Storage",
      }),
    ]);

    expect(grouped.map((g) => g.category)).toEqual([
      "Oil & Fluids",
      "Brakes",
      "Tires",
      "Storage",
    ]);
    expect(grouped[1].services.map((s) => s.name)).toEqual(["Brake Service"]);
  });

  it("puts blank and null categories into Other last", () => {
    const grouped = groupServicesByCategory([
      service({ service_id: "1", name: "Custom", category: null }),
      service({ service_id: "2", name: "Oil Change", category: "Oil & Fluids" }),
      service({ service_id: "3", name: "Misc", category: "  " }),
    ]);

    expect(grouped.map((g) => g.category)).toEqual([
      "Oil & Fluids",
      UNCATEGORISED_SERVICE_GROUP,
    ]);
    expect(grouped[1].services.map((s) => s.name)).toEqual(["Custom", "Misc"]);
  });

  it("sorts services alphabetically within a category", () => {
    const grouped = groupServicesByCategory([
      service({ service_id: "1", name: "Rear tire", category: "Tires" }),
      service({ service_id: "2", name: "Front tire", category: "Tires" }),
    ]);
    expect(grouped[0].services.map((s) => s.name)).toEqual([
      "Front tire",
      "Rear tire",
    ]);
  });

  it("returns an empty list for no services", () => {
    expect(groupServicesByCategory([])).toEqual([]);
  });

  it("defines a complete preferred category order ending with Other", () => {
    expect(SERVICE_CATEGORY_ORDER.at(-1)).toBe("Other");
  });
});
