import { describe, expect, it } from "vitest";
import { nextDocketPosition } from "@/lib/technician/docketOrder";

/**
 * Documents the contract: assigning a job must land it at the end of the
 * tech's open docket (position = max + 1), so it appears in What's next.
 */
describe("job assignment → docket position", () => {
  it("new assignments append after existing docket jobs", () => {
    expect(nextDocketPosition([1, 2, 3])).toBe(4);
    expect(nextDocketPosition([])).toBe(1);
  });
});
