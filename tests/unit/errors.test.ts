import { describe, expect, it } from "vitest";
import { toFormErrorMessage } from "@/lib/services/errors";

describe("toFormErrorMessage", () => {
  it("maps CONTRACT_REQUIRED to the technician-gate copy", () => {
    expect(toFormErrorMessage(new Error("CONTRACT_REQUIRED"))).toBe(
      "Sign the drop-off agreement before pulling or marking ready for technician."
    );
  });

  it("maps QC_REQUIRED for pickup gate parity", () => {
    expect(toFormErrorMessage(new Error("QC_REQUIRED"))).toBe(
      "Complete the quality check before marking ready for pickup."
    );
  });

  it("maps password change validation errors", () => {
    expect(toFormErrorMessage(new Error("CURRENT_PASSWORD_INVALID"))).toBe(
      "Current password is incorrect."
    );
    expect(toFormErrorMessage(new Error("NEW_PASSWORD_TOO_SHORT"))).toBe(
      "New password must be at least 8 characters."
    );
    expect(toFormErrorMessage(new Error("PASSWORD_CONFIRM_MISMATCH"))).toBe(
      "New password and confirmation do not match."
    );
  });
});
