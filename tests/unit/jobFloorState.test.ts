import { describe, expect, it } from "vitest";
import { floorIdempotencyKey } from "@/lib/services/jobFloorState";

const JOB = "11111111-1111-4111-8111-111111111111";
const TECH = "22222222-2222-4222-8222-222222222222";

describe("floorIdempotencyKey", () => {
  it("is deterministic for the same intent within a bucket", () => {
    const now = Date.parse("2026-07-20T10:00:05Z");
    const a = floorIdempotencyKey("complete", JOB, TECH, { nowMs: now });
    const b = floorIdempotencyKey("complete", JOB, TECH, { nowMs: now + 5_000 });
    expect(a).toBe(b);
    expect(a).toContain("complete");
    expect(a).toContain(JOB);
    expect(a).toContain(TECH);
  });

  it("changes across time buckets so later intents are not replayed", () => {
    const now = Date.parse("2026-07-20T10:00:00Z");
    const first = floorIdempotencyKey("park", JOB, TECH, { nowMs: now });
    const later = floorIdempotencyKey("park", JOB, TECH, { nowMs: now + 61_000 });
    expect(first).not.toBe(later);
  });

  it("pull uses a short bucket so a re-pull after a swap is a fresh intent", () => {
    const now = Date.parse("2026-07-20T10:00:00Z");
    const doubleTap = floorIdempotencyKey("pull", JOB, TECH, { nowMs: now + 3_000 });
    const rePull = floorIdempotencyKey("pull", JOB, TECH, { nowMs: now + 16_000 });
    expect(floorIdempotencyKey("pull", JOB, TECH, { nowMs: now })).toBe(doubleTap);
    expect(doubleTap).not.toBe(rePull);
  });

  it("differs across intents, jobs, actors, and extras", () => {
    const now = Date.parse("2026-07-20T10:00:00Z");
    const base = floorIdempotencyKey("park", JOB, TECH, { nowMs: now });
    expect(floorIdempotencyKey("complete", JOB, TECH, { nowMs: now })).not.toBe(base);
    expect(floorIdempotencyKey("park", TECH, TECH, { nowMs: now })).not.toBe(base);
    expect(floorIdempotencyKey("park", JOB, JOB, { nowMs: now })).not.toBe(base);
    expect(
      floorIdempotencyKey("park", JOB, TECH, { nowMs: now, extra: "parts" })
    ).not.toBe(base);
  });
});
