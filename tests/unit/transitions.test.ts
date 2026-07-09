import { describe, it, expect } from "vitest";
import {
  getTargetStatusForColumn,
  canDropInColumn,
} from "@/lib/status/transitions";

describe("board transitions", () => {
  it("maps intake column drop to open", () => {
    expect(getTargetStatusForColumn("intake")).toBe("open");
  });

  it("blocks technician from dropping into quality_check", () => {
    expect(
      canDropInColumn("technician", "qc", "in_progress")
    ).toBe(false);
  });

  it("allows manager to drop in_progress into qc column", () => {
    expect(
      canDropInColumn("manager", "qc", "in_progress")
    ).toBe(true);
  });
});
