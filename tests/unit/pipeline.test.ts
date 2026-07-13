import { describe, expect, it } from "vitest";
import {
  getPipelineStageIndex,
  getWorkOrderNextAction,
  VISIT_PIPELINE_STAGES,
} from "@/lib/status/pipeline";

describe("getPipelineStageIndex", () => {
  it("maps operational statuses to pipeline stages", () => {
    expect(getPipelineStageIndex("draft")).toBe(0);
    expect(getPipelineStageIndex("inspection_in_progress")).toBe(1);
    expect(getPipelineStageIndex("waiting_for_customer_approval")).toBe(2);
    expect(getPipelineStageIndex("in_progress")).toBe(4);
    expect(getPipelineStageIndex("ready_for_pickup")).toBe(6);
  });

  it("returns -1 for cancelled and -2 for on hold", () => {
    expect(getPipelineStageIndex("cancelled")).toBe(-1);
    expect(getPipelineStageIndex("on_hold")).toBe(-2);
  });
});

describe("getWorkOrderNextAction", () => {
  it("prioritizes blocking flags over status", () => {
    expect(
      getWorkOrderNextAction("in_progress", ["Incomplete inspection"])
    ).toContain("inspection");
    expect(
      getWorkOrderNextAction("ready_for_technician", ["Needs approval"])
    ).toContain("approval");
    expect(
      getWorkOrderNextAction("open", ["Contract unsigned"])
    ).toBe("Get drop-off agreement signed");
  });

  it("returns status-specific hints when no flags", () => {
    expect(getWorkOrderNextAction("quality_check", [])).toContain("quality");
    expect(getWorkOrderNextAction("waiting_for_parts", [])).toContain("parts");
    expect(getWorkOrderNextAction("open", [])).toBe("Start inspection");
    expect(getWorkOrderNextAction("open", ["No intake photos"])).toBe(
      "Capture intake photos"
    );
  });
});

describe("VISIT_PIPELINE_STAGES", () => {
  it("covers the main operational flow", () => {
    expect(VISIT_PIPELINE_STAGES).toHaveLength(7);
  });
});
