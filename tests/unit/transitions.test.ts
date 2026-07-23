import { describe, it, expect } from "vitest";
import { getTargetStatusForColumn, canDropInColumn } from "@/lib/status/transitions";

describe("board transitions", () => {
  it("maps intake column drop to open", () => {
    expect(getTargetStatusForColumn("intake")).toBe("open");
  });

  it("blocks technician from dropping into quality_check", () => {
    expect(canDropInColumn("technician", "qc", "in_progress")).toBe(false);
  });

  it("allows manager to drop in_progress into qc column", () => {
    expect(canDropInColumn("manager", "qc", "in_progress")).toBe(true);
  });

  it("maps complete column to completed and gates by front office", () => {
    expect(getTargetStatusForColumn("complete")).toBe("completed");
    expect(canDropInColumn("service_advisor", "complete", "ready_for_pickup")).toBe(true);
    expect(canDropInColumn("technician", "complete", "ready_for_pickup")).toBe(false);
    expect(canDropInColumn("service_advisor", "complete", "completed")).toBe(false);
  });
});
