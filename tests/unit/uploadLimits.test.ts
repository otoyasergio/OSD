import { describe, expect, it } from "vitest";
import {
  SERVER_ACTION_UPLOAD_MAX_BYTES,
  VERCEL_FUNCTION_BODY_LIMIT_BYTES,
  exceedsServerActionUploadLimit,
  formatMegabytes,
} from "@/lib/forms/uploadLimits";

describe("server action upload limits", () => {
  it("leaves multipart headroom under Vercel's 4.5 MB function body cap", () => {
    expect(VERCEL_FUNCTION_BODY_LIMIT_BYTES).toBe(4_500_000);
    expect(SERVER_ACTION_UPLOAD_MAX_BYTES).toBeLessThan(VERCEL_FUNCTION_BODY_LIMIT_BYTES);
    expect(
      VERCEL_FUNCTION_BODY_LIMIT_BYTES - SERVER_ACTION_UPLOAD_MAX_BYTES
    ).toBeGreaterThan(100_000);
  });

  it("flags files the platform would refuse", () => {
    expect(exceedsServerActionUploadLimit({ size: SERVER_ACTION_UPLOAD_MAX_BYTES })).toBe(
      false
    );
    expect(
      exceedsServerActionUploadLimit({ size: SERVER_ACTION_UPLOAD_MAX_BYTES + 1 })
    ).toBe(true);
    // The size production photos were silently dying at.
    expect(exceedsServerActionUploadLimit({ size: 4_600_000 })).toBe(true);
  });

  it("formats sizes the way the limits are stated", () => {
    expect(formatMegabytes(4_000_000)).toBe("4 MB");
    expect(formatMegabytes(3_500_000)).toBe("3.5 MB");
    expect(formatMegabytes(6_149_000)).toBe("6.1 MB");
    expect(formatMegabytes(12_400_000)).toBe("12 MB");
  });
});
