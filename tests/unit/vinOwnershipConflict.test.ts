import { describe, expect, it } from "vitest";
import {
  buildVinOwnershipConflict,
  isVinOwnedByOtherCustomer,
} from "@/lib/services/motorcycles";

const BIKE = {
  motorcycle_id: "00000000-0000-4000-8000-0000000000b1",
  customer_id: "00000000-0000-4000-8000-0000000000c1",
  year: 2020,
  make: "Honda",
  model: "CBR600RR",
  vin: "JH2PC4000XM000001",
  customer: { first_name: "Ada", last_name: "Lovelace" },
};

describe("isVinOwnedByOtherCustomer", () => {
  it("is false when no motorcycle matches the VIN", () => {
    expect(
      isVinOwnedByOtherCustomer({
        existing: null,
        currentCustomerId: "00000000-0000-4000-8000-0000000000c2",
      })
    ).toBe(false);
  });

  it("is false when the VIN already belongs to the current customer", () => {
    expect(
      isVinOwnedByOtherCustomer({
        existing: BIKE,
        currentCustomerId: BIKE.customer_id,
      })
    ).toBe(false);
  });

  it("is true when another customer owns the VIN", () => {
    expect(
      isVinOwnedByOtherCustomer({
        existing: BIKE,
        currentCustomerId: "00000000-0000-4000-8000-0000000000c2",
      })
    ).toBe(true);
  });

  it("ignores the motorcycle being edited (same id)", () => {
    expect(
      isVinOwnedByOtherCustomer({
        existing: BIKE,
        currentCustomerId: "00000000-0000-4000-8000-0000000000c2",
        excludeMotorcycleId: BIKE.motorcycle_id,
      })
    ).toBe(false);
  });
});

describe("buildVinOwnershipConflict", () => {
  it("builds a notice payload with owner name and bike label", () => {
    expect(buildVinOwnershipConflict(BIKE)).toEqual({
      motorcycle_id: BIKE.motorcycle_id,
      customer_id: BIKE.customer_id,
      owner_name: "Ada Lovelace",
      bike_label: "2020 Honda CBR600RR",
      vin: BIKE.vin,
    });
  });
});
