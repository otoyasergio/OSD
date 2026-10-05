import { describe, it, expect } from "vitest";
import {
  MOTORCYCLE_SEARCH_CUSTOMER_ID_CAP,
  buildMotorcycleSearchOrFilter,
} from "@/lib/services/motorcycles";

const CUSTOMER_A = "11111111-1111-4111-8111-111111111111";
const CUSTOMER_B = "22222222-2222-4222-8222-222222222222";

describe("buildMotorcycleSearchOrFilter", () => {
  it("searches make, model, vin, and plate number", () => {
    expect(buildMotorcycleSearchOrFilter("honda", [])).toBe(
      'make.ilike."%honda%",model.ilike."%honda%",vin.ilike."%honda%",plate_number.ilike."%honda%"'
    );
  });

  it("adds an exact year match for four digit terms", () => {
    expect(buildMotorcycleSearchOrFilter("2022", [])).toContain("year.eq.2022");
  });

  it("does not add a year match for non-year numbers", () => {
    expect(buildMotorcycleSearchOrFilter("600", [])).not.toContain("year.eq");
  });

  it("includes matching customer ids", () => {
    expect(buildMotorcycleSearchOrFilter("ada", [CUSTOMER_A, CUSTOMER_B])).toContain(
      `customer_id.in.(${CUSTOMER_A},${CUSTOMER_B})`
    );
  });

  it("escapes ilike wildcards in the term", () => {
    expect(buildMotorcycleSearchOrFilter("cb_600", [])).toContain(
      'make.ilike."%cb\\\\_600%"'
    );
  });

  it("keeps the owner id list inside the URL cap", () => {
    const ids = Array.from(
      { length: MOTORCYCLE_SEARCH_CUSTOMER_ID_CAP + 10 },
      (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`
    );
    const filter = buildMotorcycleSearchOrFilter("ada", ids);
    const included = ids.filter((id) => filter.includes(id));
    expect(included).toEqual(ids.slice(0, MOTORCYCLE_SEARCH_CUSTOMER_ID_CAP));
    expect(filter).not.toContain(ids[MOTORCYCLE_SEARCH_CUSTOMER_ID_CAP]);
  });
});
