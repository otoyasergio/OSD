import { describe, expect, it } from "vitest";
import { summarizeCustomerVisits } from "@/lib/customers/glance";

describe("summarizeCustomerVisits", () => {
  it("counts open and completed visits the same way the profile lists do", () => {
    const glance = summarizeCustomerVisits([
      {
        status: "completed",
        completed_at: "2026-08-01T15:00:00.000Z",
        date_created: "2026-07-28T15:00:00.000Z",
        billing_collected_cents: 15000,
      },
      {
        status: "in_progress",
        completed_at: null,
        date_created: "2026-08-20T15:00:00.000Z",
        billing_collected_cents: 5000,
      },
      {
        status: "cancelled",
        completed_at: null,
        date_created: "2026-06-01T15:00:00.000Z",
        billing_collected_cents: 0,
      },
    ]);

    expect(glance.open_visit_count).toBe(2);
    expect(glance.completed_visit_count).toBe(1);
  });

  it("sums collected cents across every work order, including open visits", () => {
    const glance = summarizeCustomerVisits([
      {
        status: "completed",
        completed_at: "2026-08-01T15:00:00.000Z",
        date_created: "2026-07-28T15:00:00.000Z",
        billing_collected_cents: 15000,
      },
      {
        status: "in_progress",
        completed_at: null,
        date_created: "2026-08-20T15:00:00.000Z",
        billing_collected_cents: 5000,
      },
      {
        status: "cancelled",
        completed_at: null,
        date_created: "2026-06-01T15:00:00.000Z",
        billing_collected_cents: 9000,
      },
    ]);

    expect(glance.collected_cents).toBe(29000);
  });

  it("uses the newest completed_at or date_created as the last visit", () => {
    const glance = summarizeCustomerVisits([
      {
        status: "completed",
        completed_at: "2026-08-10T15:00:00.000Z",
        date_created: "2026-08-01T15:00:00.000Z",
        billing_collected_cents: 0,
      },
      {
        status: "open",
        completed_at: null,
        date_created: "2026-08-25T15:00:00.000Z",
        billing_collected_cents: null,
      },
    ]);

    expect(glance.last_visit_at).toBe("2026-08-25T15:00:00.000Z");
  });

  it("returns an empty glance when the customer has no work orders", () => {
    expect(summarizeCustomerVisits([])).toEqual({
      open_visit_count: 0,
      completed_visit_count: 0,
      last_visit_at: null,
      collected_cents: 0,
    });
  });
});
