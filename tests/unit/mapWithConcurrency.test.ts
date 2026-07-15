import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "@/lib/forms/mapWithConcurrency";

describe("mapWithConcurrency", () => {
  it("preserves result order and never exceeds the worker limit", async () => {
    let active = 0;
    let maxActive = 0;

    const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (item) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, item % 2 === 0 ? 1 : 3));
      active -= 1;
      return item * 10;
    });

    expect(results).toEqual([10, 20, 30, 40, 50, 60]);
    expect(maxActive).toBe(2);
  });

  it("handles an empty queue without starting workers", async () => {
    let calls = 0;
    const results = await mapWithConcurrency([], 2, async () => {
      calls += 1;
      return true;
    });

    expect(results).toEqual([]);
    expect(calls).toBe(0);
  });

  it("rejects invalid worker limits", async () => {
    await expect(mapWithConcurrency([1], 0, async (item) => item)).rejects.toThrow(
      "Concurrency must be a positive integer."
    );
  });
});
