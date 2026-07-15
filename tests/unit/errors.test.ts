import { describe, expect, it } from "vitest";
import { toFormErrorMessage } from "@/lib/services/errors";

describe("toFormErrorMessage", () => {
  it("maps QC_REQUIRED for pickup gate parity", () => {
    expect(toFormErrorMessage(new Error("QC_REQUIRED"))).toBe(
      "Complete the quality check before marking ready for pickup."
    );
  });

  it("maps paper agreement copy errors", () => {
    expect(toFormErrorMessage(new Error("PAPER_AGREEMENT_REQUIRED"))).toBe(
      "Mark the agreement as signed by paper before uploading its copy."
    );
    expect(toFormErrorMessage(new Error("PAPER_COPY_ALREADY_UPLOADED"))).toBe(
      "A signed paper agreement copy is already on file."
    );
  });

  it("maps missing service prices", () => {
    expect(toFormErrorMessage(new Error("SERVICE_PRICE_REQUIRED"))).toBe(
      "Enter a price for every selected service before creating the work order."
    );
  });

  it("maps shop closure errors", () => {
    expect(toFormErrorMessage(new Error("SHOP_CLOSURE_EXISTS"))).toBe(
      "That date is already marked as closed."
    );
    expect(toFormErrorMessage(new Error("SHOP_CLOSURE_IN_PAST"))).toBe(
      "Choose today or a future date."
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
