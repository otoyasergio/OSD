import { describe, it, expect } from "vitest";
import {
  customerSchema,
  motorcycleSchema,
  serviceSchema,
} from "@/lib/validation/schemas";

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

describe("serviceSchema", () => {
  it("requires a name", () => {
    const result = serviceSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  it("allows null price and labour and defaults active to true", () => {
    const result = serviceSchema.safeParse({
      name: "Oil Change",
      standard_price: null,
      estimated_labour: null,
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.active).toBe(true);
  });

  it("rejects negative prices", () => {
    const result = serviceSchema.safeParse({
      name: "Oil Change",
      standard_price: -10,
    });
    expect(result.success).toBe(false);
  });
});
