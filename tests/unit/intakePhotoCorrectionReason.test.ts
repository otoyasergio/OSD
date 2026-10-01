import { describe, expect, it } from "vitest";
import {
  PHOTO_CORRECTION_REASON_MAX_LENGTH,
  parseIntakePhotoCorrectionReason,
} from "@/lib/photos/intakePhotoCorrectionReason";
import { toFormErrorMessage } from "@/lib/services/errors";

describe("parseIntakePhotoCorrectionReason", () => {
  it("rejects blank and whitespace-only reasons", () => {
    expect(() => parseIntakePhotoCorrectionReason("")).toThrow(
      "PHOTO_CORRECTION_REASON_REQUIRED"
    );
    expect(() => parseIntakePhotoCorrectionReason("   \n\t")).toThrow(
      "PHOTO_CORRECTION_REASON_REQUIRED"
    );
  });

  it("rejects oversized reasons after trim", () => {
    expect(() =>
      parseIntakePhotoCorrectionReason("x".repeat(PHOTO_CORRECTION_REASON_MAX_LENGTH + 1))
    ).toThrow("PHOTO_CORRECTION_REASON_TOO_LONG");
  });

  it("returns a trimmed reason at the length limit", () => {
    const reason = `  ${"ok".repeat(10)}  `;
    expect(parseIntakePhotoCorrectionReason(reason)).toBe(reason.trim());
    expect(
      parseIntakePhotoCorrectionReason("y".repeat(PHOTO_CORRECTION_REASON_MAX_LENGTH))
    ).toHaveLength(PHOTO_CORRECTION_REASON_MAX_LENGTH);
  });

  it("maps blank and oversized reasons to safe staff copy", () => {
    expect(toFormErrorMessage(new Error("PHOTO_CORRECTION_REASON_REQUIRED"))).toBe(
      "Enter a reason for permanently removing this photo."
    );
    expect(toFormErrorMessage(new Error("PHOTO_CORRECTION_REASON_TOO_LONG"))).toBe(
      "Keep the correction reason to 500 characters or fewer."
    );
    expect(PHOTO_CORRECTION_REASON_MAX_LENGTH).toBe(500);
  });
});
