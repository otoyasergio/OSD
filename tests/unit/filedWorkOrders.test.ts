import { describe, it, expect } from "vitest";
import {
  matchesFiledWorkOrderSearch,
  partitionCustomerWorkOrders,
  type FiledWorkOrderSearchFields,
  type CustomerWorkOrderSummary,
} from "@/lib/services/filedWorkOrders";

function fields(
  overrides: Partial<FiledWorkOrderSearchFields> = {}
): FiledWorkOrderSearchFields {
  return {
    work_order_number: "WO-1001",
    external_invoice_number: "INV-9",
    customer_first_name: "Ada",
    customer_last_name: "Lovelace",
    customer_phone: "555-0100",
    bike_year: 2020,
    bike_make: "Honda",
    bike_model: "CBR600",
    bike_vin: "JH2PC4000XM000001",
    ...overrides,
  };
}

describe("matchesFiledWorkOrderSearch", () => {
  it("matches empty query", () => {
    expect(matchesFiledWorkOrderSearch(fields(), "")).toBe(true);
    expect(matchesFiledWorkOrderSearch(fields(), "   ")).toBe(true);
  });

  it("matches work order number, customer, and bike", () => {
    expect(matchesFiledWorkOrderSearch(fields(), "WO-1001")).toBe(true);
    expect(matchesFiledWorkOrderSearch(fields(), "ada")).toBe(true);
    expect(matchesFiledWorkOrderSearch(fields(), "honda")).toBe(true);
    expect(matchesFiledWorkOrderSearch(fields(), "cbr")).toBe(true);
    expect(matchesFiledWorkOrderSearch(fields(), "XM000001")).toBe(true);
  });

  it("is case-insensitive and requires a haystack hit", () => {
    expect(matchesFiledWorkOrderSearch(fields(), "LOVELACE")).toBe(true);
    expect(matchesFiledWorkOrderSearch(fields(), "yamaha")).toBe(false);
  });
});

describe("partitionCustomerWorkOrders", () => {
  const rows: CustomerWorkOrderSummary[] = [
    {
      work_order_id: "a",
      work_order_number: "WO-1",
      status: "completed",
      completed_at: "2026-01-02T00:00:00Z",
      date_created: "2026-01-01T00:00:00Z",
      location_name: "Main",
      location_code: "MAIN",
      motorcycle_label: "2020 Honda CBR600",
      jobs: [{ service_name_snapshot: "Oil change", status: "completed" }],
    },
    {
      work_order_id: "b",
      work_order_number: "WO-2",
      status: "in_progress",
      completed_at: null,
      date_created: "2026-02-01T00:00:00Z",
      location_name: "Main",
      location_code: "MAIN",
      motorcycle_label: "2020 Honda CBR600",
      jobs: [{ service_name_snapshot: "Brake pads", status: "in_progress" }],
    },
    {
      work_order_id: "c",
      work_order_number: "WO-3",
      status: "cancelled",
      completed_at: null,
      date_created: "2025-12-01T00:00:00Z",
      location_name: "North",
      location_code: "NTH",
      motorcycle_label: "2018 Yamaha R3",
      jobs: [],
    },
  ];

  it("puts completed WOs in filed and the rest in open", () => {
    const { open, filed } = partitionCustomerWorkOrders(rows);
    expect(filed.map((r) => r.work_order_id)).toEqual(["a"]);
    expect(open.map((r) => r.work_order_id)).toEqual(["b", "c"]);
  });

  it("sorts filed by completed_at desc then date_created desc", () => {
    const unsorted: CustomerWorkOrderSummary[] = [
      {
        ...rows[0],
        work_order_id: "older",
        completed_at: "2025-01-01T00:00:00Z",
        date_created: "2024-12-01T00:00:00Z",
      },
      {
        ...rows[0],
        work_order_id: "newer",
        completed_at: "2026-06-01T00:00:00Z",
        date_created: "2026-05-01T00:00:00Z",
      },
    ];
    const { filed } = partitionCustomerWorkOrders(unsorted);
    expect(filed.map((r) => r.work_order_id)).toEqual(["newer", "older"]);
  });
});
