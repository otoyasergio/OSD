import { describe, expect, it } from "vitest";
import { validateMotorcycleTransfer } from "@/lib/services/motorcycles";

const BIKE = {
  motorcycle_id: "00000000-0000-4000-8000-0000000000b1",
  customer_id: "00000000-0000-4000-8000-0000000000c1",
};

const NEW_CUSTOMER = {
  customer_id: "00000000-0000-4000-8000-0000000000c2",
};

describe("validateMotorcycleTransfer", () => {
  it("accepts a transfer to a different existing customer", () => {
    expect(
      validateMotorcycleTransfer({
        motorcycle: BIKE,
        newCustomer: NEW_CUSTOMER,
        new_customer_id: NEW_CUSTOMER.customer_id,
      })
    ).toEqual({
      from_customer_id: BIKE.customer_id,
      to_customer_id: NEW_CUSTOMER.customer_id,
    });
  });

  it("blocks transfer when the motorcycle is missing", () => {
    expect(() =>
      validateMotorcycleTransfer({
        motorcycle: null,
        newCustomer: NEW_CUSTOMER,
        new_customer_id: NEW_CUSTOMER.customer_id,
      })
    ).toThrow("MOTORCYCLE_NOT_FOUND");
  });

  it("blocks transfer when the new customer is missing", () => {
    expect(() =>
      validateMotorcycleTransfer({
        motorcycle: BIKE,
        newCustomer: null,
        new_customer_id: NEW_CUSTOMER.customer_id,
      })
    ).toThrow("CUSTOMER_NOT_FOUND");
  });

  it("blocks transfer to the current owner", () => {
    expect(() =>
      validateMotorcycleTransfer({
        motorcycle: BIKE,
        newCustomer: { customer_id: BIKE.customer_id },
        new_customer_id: BIKE.customer_id,
      })
    ).toThrow("SAME_CUSTOMER");
  });
});
