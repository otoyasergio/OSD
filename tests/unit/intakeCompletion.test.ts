import { describe, expect, it } from "vitest";
import { withIntakeFollowUp } from "@/lib/forms/intakeCompletion";

describe("intake completion links", () => {
  it("adds a signature follow-up to an existing intake query", () => {
    expect(withIntakeFollowUp("/work_orders/wo-1?intake=complete", "signature")).toBe(
      "/work_orders/wo-1?intake=complete&follow_up=signature"
    );
  });

  it("adds a paper-copy follow-up to an existing intake query", () => {
    expect(withIntakeFollowUp("/work_orders/wo-1?intake=complete", "paper_copy")).toBe(
      "/work_orders/wo-1?intake=complete&follow_up=paper_copy"
    );
  });
});
