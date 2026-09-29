import { describe, expect, it } from "vitest";
import { toFormErrorMessage } from "@/lib/services/errors";

describe("toFormErrorMessage", () => {
  it("maps QC_REQUIRED for pickup gate parity", () => {
    expect(toFormErrorMessage(new Error("QC_REQUIRED"))).toBe(
      "Complete the quality check before the bike can leave."
    );
  });

  it("maps inspection and safety leave gates", () => {
    expect(toFormErrorMessage(new Error("INSPECTION_REQUIRED_BEFORE_PICKUP"))).toBe(
      "Complete the arrival inspection report before the bike can leave."
    );
    expect(toFormErrorMessage(new Error("SAFETY_REQUIRED_BEFORE_PICKUP"))).toBe(
      "Head tech final inspection is required before the bike can leave."
    );
  });

  it("maps signature required", () => {
    expect(toFormErrorMessage(new Error("SIGNATURE_REQUIRED"))).toBe(
      "Draw your signature before submitting."
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

  it.each([
    "ASK_OTOMOTO_PARENT_REQUIRES_ASSISTANT",
    "ASK_OTOMOTO_PARENT_USER_INVALID",
    "ASK_OTOMOTO_PARENT_USER_IMMUTABLE",
    "ASK_OTOMOTO_NOTE_TYPE_NOT_ALLOWED",
    "ASK_OTOMOTO_THREAD_NOT_WRITABLE",
    "ASK_OTOMOTO_COMPLETE_CONFLICT",
    "ASK_OTOMOTO_SAFE_ERROR_INVALID",
    "ASK_OTOMOTO_FAIL_CONFLICT",
  ])("maps new Ask OTOMOTO lifecycle code %s to friendly text", (code) => {
    const message = toFormErrorMessage(new Error(code));
    expect(message).not.toBe(code);
    expect(message).toMatch(/Ask OTOMOTO|assistant|note|conversation|request/i);
  });
});
