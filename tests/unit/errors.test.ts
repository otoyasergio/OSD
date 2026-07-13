import { describe, expect, it } from "vitest";
import { toFormErrorMessage } from "@/lib/services/errors";

describe("toFormErrorMessage", () => {
  it("maps CONTRACT_REQUIRED to the technician-gate copy", () => {
    expect(toFormErrorMessage(new Error("CONTRACT_REQUIRED"))).toBe(
      "Sign the drop-off agreement before marking ready for technician."
    );
  });

  it("maps QC_REQUIRED for pickup gate parity", () => {
    expect(toFormErrorMessage(new Error("QC_REQUIRED"))).toBe(
      "Complete the quality check before marking ready for pickup."
    );
  });
});
