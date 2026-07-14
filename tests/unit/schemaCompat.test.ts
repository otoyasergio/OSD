import { describe, expect, it } from "vitest";
import { isUndefinedColumnError } from "@/lib/database/schemaCompat";

describe("isUndefinedColumnError", () => {
  it("matches Postgres 42703 undefined_column errors", () => {
    expect(
      isUndefinedColumnError({
        code: "42703",
        message: "column job.docket_position does not exist",
      })
    ).toBe(true);
  });

  it("optionally requires the column name fragment", () => {
    const error = {
      code: "42703",
      message: "column job.docket_position does not exist",
    };
    expect(isUndefinedColumnError(error, "docket_position")).toBe(true);
    expect(isUndefinedColumnError(error, "safety_checked_by_user_id")).toBe(false);
  });

  it("rejects other error codes and empty input", () => {
    expect(isUndefinedColumnError(null)).toBe(false);
    expect(isUndefinedColumnError({ code: "42501", message: "permission denied" })).toBe(
      false
    );
  });
});
