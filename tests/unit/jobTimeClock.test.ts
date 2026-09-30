import { describe, expect, it } from "vitest";
import { sumJobTimeMs } from "@/lib/services/jobTimeClock";

describe("sumJobTimeMs", () => {
  it("sums closed segments", () => {
    const ms = sumJobTimeMs([
      {
        started_at: "2026-07-15T14:00:00.000Z",
        ended_at: "2026-07-15T16:00:00.000Z",
      },
      {
        started_at: "2026-07-15T17:00:00.000Z",
        ended_at: "2026-07-15T17:30:00.000Z",
      },
    ]);
    expect(ms).toBe(2.5 * 60 * 60 * 1000);
  });

  it("uses now for open segments", () => {
    const now = new Date("2026-07-15T18:00:00.000Z").getTime();
    const ms = sumJobTimeMs(
      [
        {
          started_at: "2026-07-15T17:00:00.000Z",
          ended_at: null,
        },
      ],
      now
    );
    expect(ms).toBe(60 * 60 * 1000);
  });
});
