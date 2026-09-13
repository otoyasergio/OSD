import { describe, expect, it } from "vitest";
import {
  shouldApplyServerInspectionText,
  textSaveStillMatchesLocal,
} from "@/lib/inspections/inspectionItemTextSync";

describe("shouldApplyServerInspectionText", () => {
  it("keeps local draft while focused or dirty", () => {
    expect(shouldApplyServerInspectionText({ focused: true, dirty: false })).toBe(false);
    expect(shouldApplyServerInspectionText({ focused: false, dirty: true })).toBe(false);
    expect(shouldApplyServerInspectionText({ focused: true, dirty: true })).toBe(false);
  });

  it("accepts server text when idle and clean", () => {
    expect(shouldApplyServerInspectionText({ focused: false, dirty: false })).toBe(true);
  });
});

describe("textSaveStillMatchesLocal", () => {
  it("treats trimmed empty string and null as equal", () => {
    expect(
      textSaveStillMatchesLocal({
        localNotes: "  ",
        localMeasurement: "",
        savedNotes: null,
        savedMeasurement: null,
      })
    ).toBe(true);
  });

  it("returns false when the user typed more after the save started", () => {
    expect(
      textSaveStillMatchesLocal({
        localNotes: "brake bleed",
        localMeasurement: "",
        savedNotes: "brake ble",
        savedMeasurement: null,
      })
    ).toBe(false);
  });

  it("ignores fields that were not part of the save payload", () => {
    expect(
      textSaveStillMatchesLocal({
        localNotes: "typed after status click",
        localMeasurement: "3.2",
        savedNotes: undefined,
        savedMeasurement: undefined,
      })
    ).toBe(true);
  });
});
