import { describe, expect, it } from "vitest";
import {
  groupServicesByCategory,
  UNCATEGORISED_SERVICE_GROUP,
  type Service,
} from "@/lib/services/serviceCatalogue";

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
  it("groups services under their category labels", () => {
    const grouped = groupServicesByCategory([
      service({ service_id: "1", name: "Oil Change", category: "Maintenance" }),
      service({
        service_id: "2",
        name: "Tire Change",
        category: "Brakes & Tires",
      }),
      service({
        service_id: "3",
        name: "Brake Service",
        category: "Brakes & Tires",
      }),
    ]);

    expect(grouped.map((g) => g.category)).toEqual([
      "Brakes & Tires",
      "Maintenance",
    ]);
    expect(grouped[0].services.map((s) => s.name)).toEqual([
      "Tire Change",
      "Brake Service",
    ]);
    expect(grouped[1].services.map((s) => s.name)).toEqual(["Oil Change"]);
  });

  it("puts blank and null categories into Other last", () => {
    const grouped = groupServicesByCategory([
      service({ service_id: "1", name: "Custom", category: null }),
      service({ service_id: "2", name: "Oil Change", category: "Maintenance" }),
      service({ service_id: "3", name: "Misc", category: "  " }),
    ]);

    expect(grouped.map((g) => g.category)).toEqual([
      "Maintenance",
      UNCATEGORISED_SERVICE_GROUP,
    ]);
    expect(grouped[1].services.map((s) => s.name)).toEqual(["Custom", "Misc"]);
  });

  it("returns an empty list for no services", () => {
    expect(groupServicesByCategory([])).toEqual([]);
  });
});
