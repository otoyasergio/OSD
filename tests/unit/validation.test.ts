import { describe, it, expect } from "vitest";
import {
  customerSchema,
  motorcycleSchema,
  serviceSchema,
} from "@/lib/validation/schemas";

describe("customerSchema", () => {
  it("requires phone, email, and address", () => {
    const result = customerSchema.safeParse({
      first_name: "Ada",
      last_name: "Lovelace",
    });
    expect(result.success).toBe(false);
  });

  it("rejects phone-only and email-only customers", () => {
    const phoneOnly = customerSchema.safeParse({
      first_name: "Ada",
      last_name: "Lovelace",
      phone: "4165551212",
      address: "123 Queen St W, Toronto, ON M5H 2M9",
    });
    const emailOnly = customerSchema.safeParse({
      first_name: "Ada",
      last_name: "Lovelace",
      email: "ada@example.com",
      address: "123 Queen St W, Toronto, ON M5H 2M9",
    });
    expect(phoneOnly.success).toBe(false);
    expect(emailOnly.success).toBe(false);
  });

  it("rejects a customer without an address", () => {
    const result = customerSchema.safeParse({
      first_name: "Ada",
      last_name: "Lovelace",
      phone: "4165551212",
      email: "ada@example.com",
    });
    expect(result.success).toBe(false);
    expect(
      result.success ? [] : result.error.issues.map((issue) => issue.message)
    ).toContain("Address is required");
  });

  it("accepts the required contact and address fields", () => {
    const result = customerSchema.safeParse({
      first_name: "Ada",
      last_name: "Lovelace",
      phone: "4165551212",
      email: "ada@example.com",
      address: "123 Queen St W, Toronto, ON M5H 2M9",
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.account_type).toBe("retail");
  });

  it("accepts fleet account type", () => {
    const result = customerSchema.safeParse({
      first_name: "Fleet",
      last_name: "Co",
      phone: "4165550199",
      email: "service@fleet.example",
      address: "100 King St W, Toronto, ON M5X 1A9",
      account_type: "fleet",
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.account_type).toBe("fleet");
  });

  it("accepts a birthday with the required address", () => {
    const result = customerSchema.safeParse({
      first_name: "Ada",
      last_name: "Lovelace",
      phone: "4165551212",
      email: "ada@example.com",
      address: "123 Queen St W, Toronto, ON M5H 2M9",
      date_of_birth: "1990-12-10",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid or future birthdays", () => {
    const invalid = customerSchema.safeParse({
      first_name: "Ada",
      last_name: "Lovelace",
      phone: "4165551212",
      email: "ada@example.com",
      address: "123 Queen St W, Toronto, ON M5H 2M9",
      date_of_birth: "1990-02-30",
    });
    const future = customerSchema.safeParse({
      first_name: "Ada",
      last_name: "Lovelace",
      phone: "4165551212",
      email: "ada@example.com",
      address: "123 Queen St W, Toronto, ON M5H 2M9",
      date_of_birth: "2999-01-01",
    });
    expect(invalid.success).toBe(false);
    expect(future.success).toBe(false);
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

  it("accepts an optional category", () => {
    const withCategory = serviceSchema.safeParse({
      name: "Oil Change",
      category: "Maintenance",
    });
    expect(withCategory.success).toBe(true);
    expect(withCategory.success && withCategory.data.category).toBe("Maintenance");

    const withoutCategory = serviceSchema.safeParse({ name: "Oil Change" });
    expect(withoutCategory.success).toBe(true);
  });

  it("rejects negative prices", () => {
    const result = serviceSchema.safeParse({
      name: "Oil Change",
      standard_price: -10,
    });
    expect(result.success).toBe(false);
  });
});
