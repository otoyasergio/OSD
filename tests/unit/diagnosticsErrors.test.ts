import { describe, expect, it } from "vitest";
import { diagnosticsErrorMessage } from "@/lib/diagnostics/errors";

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
  ])("maps %s without exposing internals", (code, expected) => {
    expect(diagnosticsErrorMessage(code)).toMatch(expected);
  });
});
