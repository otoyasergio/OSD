import { describe, expect, it } from "vitest";
import { validatePasswordChangeInput } from "@/lib/services/changePassword";

describe("validatePasswordChangeInput", () => {
  const valid = {
    current_password: "old-secret",
    new_password: "new-secret",
    confirm_password: "new-secret",
  };

  it("accepts a valid password change", () => {
    expect(() => validatePasswordChangeInput(valid)).not.toThrow();
  });

  it("requires the current password", () => {
    expect(() =>
      validatePasswordChangeInput({ ...valid, current_password: "  " })
    ).toThrow("CURRENT_PASSWORD_REQUIRED");
  });

  it("requires the new password", () => {
    expect(() =>
      validatePasswordChangeInput({ ...valid, new_password: "", confirm_password: "" })
    ).toThrow("NEW_PASSWORD_REQUIRED");
  });

  it("enforces a minimum length of 8", () => {
    expect(() =>
      validatePasswordChangeInput({
        ...valid,
        new_password: "short",
        confirm_password: "short",
      })
    ).toThrow("NEW_PASSWORD_TOO_SHORT");
  });

  it("requires confirmation to match", () => {
    expect(() =>
      validatePasswordChangeInput({
        ...valid,
        confirm_password: "different-secret",
      })
    ).toThrow("PASSWORD_CONFIRM_MISMATCH");
  });

  it("rejects reusing the current password", () => {
    expect(() =>
      validatePasswordChangeInput({
        current_password: "same-secret",
        new_password: "same-secret",
        confirm_password: "same-secret",
      })
    ).toThrow("PASSWORD_UNCHANGED");
  });
});
