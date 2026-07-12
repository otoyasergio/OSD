import { describe, it, expect } from "vitest";
import {
  rankSearchResults,
  type SearchResult,
} from "@/lib/services/globalSearch";

function wo(
  id: string,
  label: string,
  meta = "Open"
): SearchResult {
  return {
    type: "work_order",
    id,
    label,
    href: `/work_orders/${id}`,
    meta,
  };
}

function customer(
  id: string,
  label: string,
  meta = "555-0100"
): SearchResult {
  return {
    type: "customer",
    id,
    label,
    href: `/customers/${id}`,
    meta,
  };
}

function motorcycle(
  id: string,
  label: string,
  meta = "Owner"
): SearchResult {
  return {
    type: "motorcycle",
    id,
    label,
    href: `/motorcycles/${id}`,
    meta,
  };
}

describe("rankSearchResults", () => {
  it("ranks WO number prefix matches first", () => {
    const results = rankSearchResults("WO-1001", [
      customer("c1", "Ada Smith"),
      motorcycle("m1", "2020 Honda CBR"),
      wo("w1", "WO-1001", "Ada Smith · Open"),
      wo("w2", "WO-2001", "Other · Open"),
    ]);

    expect(results[0]).toMatchObject({ type: "work_order", label: "WO-1001" });
  });

  it("treats WO1001 and WO-1001 as equivalent prefix matches", () => {
    const results = rankSearchResults("WO1001", [
      customer("c1", "Ada Smith"),
      wo("w1", "WO-1001"),
    ]);

    expect(results[0].label).toBe("WO-1001");
  });

  it("ranks exact customer name before partial matches", () => {
    const results = rankSearchResults("Ada Smith", [
      motorcycle("m1", "2020 Honda CBR", "Ada Smith"),
      customer("c1", "Ada Smith"),
      customer("c2", "Ada Smithson"),
      wo("w1", "WO-1001", "Ada Smith · Open"),
    ]);

    expect(results[0]).toMatchObject({ type: "customer", label: "Ada Smith" });
  });

  it("keeps partial matches after exact customer and WO prefix hits", () => {
    const results = rankSearchResults("smith", [
      motorcycle("m1", "2020 Honda CBR", "Bob Smith"),
      customer("c1", "Bob Smith"),
      customer("c2", "Smith"),
      wo("w1", "WO-1001", "Bob Smith · Open"),
    ]);

    expect(results[0]).toMatchObject({ type: "customer", label: "Smith" });
    expect(results.map((r) => r.id)).toContain("c1");
    expect(results.map((r) => r.id)).toContain("m1");
    expect(results.map((r) => r.id)).toContain("w1");
  });

  it("does not mutate the input array", () => {
    const input = [
      customer("c1", "Ada Smith"),
      wo("w1", "WO-1001"),
    ];
    const copy = [...input];
    rankSearchResults("WO-1001", input);
    expect(input).toEqual(copy);
  });
});
