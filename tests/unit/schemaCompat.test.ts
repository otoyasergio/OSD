import { describe, expect, it } from "vitest";
import {
  isUndefinedColumnError,
  isUndefinedTableError,
} from "@/lib/database/schemaCompat";

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

describe("isUndefinedTableError", () => {
  const schemaCacheMiss = {
    code: "PGRST205",
    message: "Could not find the table 'public.install_task' in the schema cache",
    hint: "Perhaps you meant the table 'public.inspection_result'",
  };

  it("matches Postgres 42P01 undefined_table errors", () => {
    expect(
      isUndefinedTableError({
        code: "42P01",
        message: 'relation "public.install_task" does not exist',
      })
    ).toBe(true);
  });

  it("matches PostgREST schema-cache misses for the named table", () => {
    expect(isUndefinedTableError(schemaCacheMiss, "install_task")).toBe(true);
  });

  it("does not treat the schema-cache hint table as the missing table", () => {
    expect(isUndefinedTableError(schemaCacheMiss, "inspection_result")).toBe(false);
  });

  it("rejects unrelated errors and empty input", () => {
    expect(isUndefinedTableError(null)).toBe(false);
    expect(
      isUndefinedTableError({
        code: "42501",
        message: "permission denied for table install_task",
      })
    ).toBe(false);
    expect(
      isUndefinedTableError(
        {
          code: "PGRST205",
          message: "Could not find the table 'public.estimate' in the schema cache",
        },
        "install_task"
      )
    ).toBe(false);
  });
});
