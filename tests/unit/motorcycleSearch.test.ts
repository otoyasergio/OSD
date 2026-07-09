import { describe, it, expect } from "vitest";
import { buildMotorcycleSearchOrFilter } from "@/lib/services/motorcycles";

const CUSTOMER_A = "11111111-1111-4111-8111-111111111111";
const CUSTOMER_B = "22222222-2222-4222-8222-222222222222";

describe("buildMotorcycleSearchOrFilter", () => {
  it("searches make, model, and vin", () => {
    expect(buildMotorcycleSearchOrFilter("honda", [])).toBe(
      "make.ilike.%honda%,model.ilike.%honda%,vin.ilike.%honda%"
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
      "make.ilike.%cb\\_600%"
    );
  });
});
