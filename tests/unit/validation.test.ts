import { describe, it, expect } from "vitest";
import { customerSchema, motorcycleSchema } from "@/lib/validation/schemas";

describe("customerSchema", () => {
  it("requires phone or email", () => {
    const result = customerSchema.safeParse({
      first_name: "Ada",
      last_name: "Lovelace",
    });
    expect(result.success).toBe(false);
  });

  it("accepts phone only", () => {
    const result = customerSchema.safeParse({
      first_name: "Ada",
      last_name: "Lovelace",
      phone: "4165551212",
    });
    expect(result.success).toBe(true);
  });
});

describe("motorcycleSchema", () => {
  it("requires year make model customer", () => {
    const result = motorcycleSchema.safeParse({
      customer_id: "00000000-0000-4000-8000-000000000001",
      year: 2022,
      make: "Honda",
      model: "CBR600RR",
    });
    expect(result.success).toBe(true);
  });
});
