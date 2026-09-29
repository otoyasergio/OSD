import { describe, expect, it } from "vitest";
import { diagnosticsErrorMessage } from "@/lib/diagnostics/errors";
import { toFormErrorMessage } from "@/lib/services/errors";

describe("diagnostics safe error messages", () => {
  it.each([
    ["DIAGNOSTICS_CONTEXT_TOO_LARGE", /context/i],
    ["DIAGNOSTICS_CONTEXT_TIME_INVALID", /timestamp/i],
    ["DIAGNOSTICS_AI_CONTEXT_AUDIENCE_MISMATCH", /mode/i],
    ["DIAGNOSTICS_IMAGE_JOB_REQUIRED", /job/i],
    ["DIAGNOSTICS_IMAGE_FORMAT_UNSUPPORTED", /JPEG, PNG, WebP, HEIC, or HEIF/i],
    ["DIAGNOSTICS_IMAGE_PIXEL_LIMIT", /50 megapixels/i],
    ["DIAGNOSTICS_IMAGE_TOO_LARGE", /10 MB/i],
    ["DIAGNOSTICS_IMAGE_DECODE_FAILED", /read/i],
    ["DIAGNOSTICS_AI_RESPONSE_SCHEMA_INVALID", /structured/i],
    ["DIAGNOSTICS_AI_RESPONSE_PARSE_FAILED", /parse/i],
    ["DIAGNOSTICS_AI_RESPONSE_REFUSED", /refused/i],
    ["DIAGNOSTICS_AI_RESPONSE_MODEL_MISSING", /model/i],
    ["DIAGNOSTICS_AI_CONTEXT_UNSAFE", /unsafe context/i],
    ["DIAGNOSTICS_IMAGE_NORMALIZED_TOO_LARGE", /normalized/i],
  ])("maps %s without exposing internals", (code, expected) => {
    expect(diagnosticsErrorMessage(code)).toMatch(expected);
  });

  it("wires diagnostics messages into the shared form mapper without stale GIF support", () => {
    const format = toFormErrorMessage(new Error("DIAGNOSTICS_AI_IMAGE_INVALID"));
    expect(format).toMatch(/JPEG, PNG, WebP, HEIC, or HEIF/i);
    expect(format).not.toMatch(/GIF/i);
    expect(toFormErrorMessage(new Error("DIAGNOSTICS_IMAGE_TOO_LARGE"))).toMatch(
      /10 MB/i
    );
    expect(
      toFormErrorMessage(new Error("DIAGNOSTICS_IMAGE_NORMALIZED_TOO_LARGE"))
    ).toMatch(/normalized/i);
  });
});
