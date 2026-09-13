import { describe, expect, it } from "vitest";
import { buildBikeSnapshot } from "@/lib/motorcycles/bikeSnapshot";

describe("buildBikeSnapshot", () => {
  const now = new Date("2026-08-30T12:00:00.000Z");

  it("sums lifetime collected only from completed visits", () => {
    const snapshot = buildBikeSnapshot(
      [
        {
          status: "completed",
          completed_at: "2026-08-01T12:00:00.000Z",
          date_created: "2026-07-28T12:00:00.000Z",
          billing_collected_cents: 15000,
        },
        {
          status: "in_progress",
          completed_at: null,
          date_created: "2026-08-20T12:00:00.000Z",
          billing_collected_cents: 5000,
        },
        {
          status: "cancelled",
          completed_at: null,
          date_created: "2026-06-01T12:00:00.000Z",
          billing_collected_cents: 9000,
        },
      ],
      now
    );

    expect(snapshot.lifetime_collected_cents).toBe(15000);
    expect(snapshot.visit_count).toBe(2);
    expect(snapshot.completed_visit_count).toBe(1);
  });

  it("uses the newest completed_at or date_created for last visit", () => {
    const snapshot = buildBikeSnapshot(
      [
        {
          status: "completed",
          completed_at: "2026-08-10T12:00:00.000Z",
          date_created: "2026-08-01T12:00:00.000Z",
          billing_collected_cents: 0,
        },
        {
          status: "open",
          completed_at: null,
          date_created: "2026-08-25T12:00:00.000Z",
          billing_collected_cents: 0,
        },
      ],
      now
    );

    expect(snapshot.last_visit_at).toBe("2026-08-25T12:00:00.000Z");
    expect(snapshot.days_since_last_visit).toBe(5);
  });

  it("returns empty snapshot when there are no visits", () => {
    expect(buildBikeSnapshot([], now)).toEqual({
      visit_count: 0,
      completed_visit_count: 0,
      last_visit_at: null,
      days_since_last_visit: null,
      lifetime_collected_cents: 0,
    });
  });
});
