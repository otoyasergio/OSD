import { describe, it, expect } from "vitest";
import { formatWorkOrderNumber } from "@/lib/services/workOrderNumber";

describe("formatWorkOrderNumber", () => {
  it("formats WO-1001", () => {
    expect(formatWorkOrderNumber(1001)).toBe("WO-1001");
  });
});
