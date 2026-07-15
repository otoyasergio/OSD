import { describe, expect, it } from "vitest";
import { stageChipClass } from "@/components/ui/StageChip";

describe("stageChipClass", () => {
  it("builds tone class names", () => {
    expect(stageChipClass("orange")).toBe("stage-chip stage-chip--orange");
    expect(stageChipClass("teal")).toBe("stage-chip stage-chip--teal");
  });
});
