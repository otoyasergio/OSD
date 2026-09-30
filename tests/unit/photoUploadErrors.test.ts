import { describe, expect, it } from "vitest";
import {
  PHOTO_TOO_LARGE_TO_UPLOAD_MESSAGE,
  PHOTO_UPLOAD_CONNECTION_MESSAGE,
  PHOTO_UPLOAD_FAILED_MESSAGE,
  UNREADABLE_PHOTO_MESSAGE,
  describePhotoUploadFailure,
  isPayloadTooLargeFailure,
  isRetryablePhotoUploadFailure,
  photoTooLargeMessage,
} from "@/lib/forms/photoUploadErrors";

describe("isPayloadTooLargeFailure", () => {
  it("recognises Vercel and Next body-size rejections", () => {
    expect(isPayloadTooLargeFailure("413 FUNCTION_PAYLOAD_TOO_LARGE")).toBe(true);
    expect(isPayloadTooLargeFailure("Request Entity Too Large")).toBe(true);
    expect(isPayloadTooLargeFailure("Body exceeded 64mb limit.")).toBe(true);
  });

  it("does not match unrelated failures", () => {
    expect(isPayloadTooLargeFailure("Failed to fetch")).toBe(false);
    expect(isPayloadTooLargeFailure("Photos must be 10 MB or smaller.")).toBe(false);
    expect(isPayloadTooLargeFailure(null)).toBe(false);
  });
});

describe("describePhotoUploadFailure", () => {
  it("turns a platform 413 into a non-retryable too-large message", () => {
    const message = describePhotoUploadFailure(
      new Error("413 FUNCTION_PAYLOAD_TOO_LARGE")
    );
    expect(message).toBe(PHOTO_TOO_LARGE_TO_UPLOAD_MESSAGE);
    expect(isRetryablePhotoUploadFailure(message)).toBe(false);
  });

  it("turns network drops into a retryable connection message", () => {
    const message = describePhotoUploadFailure(new TypeError("Failed to fetch"));
    expect(message).toBe(PHOTO_UPLOAD_CONNECTION_MESSAGE);
    expect(isRetryablePhotoUploadFailure(message)).toBe(true);
  });

  it("hides framework internals behind the generic retryable message", () => {
    const message = describePhotoUploadFailure(
      new Error("An unexpected response was received from the server.")
    );
    expect(message).toBe(PHOTO_UPLOAD_FAILED_MESSAGE);
    expect(isRetryablePhotoUploadFailure(message)).toBe(true);
    expect(describePhotoUploadFailure(undefined)).toBe(PHOTO_UPLOAD_FAILED_MESSAGE);
  });

  it("keeps messages the app already wrote for the user", () => {
    expect(describePhotoUploadFailure(new Error(UNREADABLE_PHOTO_MESSAGE))).toBe(
      UNREADABLE_PHOTO_MESSAGE
    );
    expect(describePhotoUploadFailure(new Error(PHOTO_TOO_LARGE_TO_UPLOAD_MESSAGE))).toBe(
      PHOTO_TOO_LARGE_TO_UPLOAD_MESSAGE
    );
  });
});

describe("photoTooLargeMessage", () => {
  it("names the actual size and the limit", () => {
    const message = photoTooLargeMessage({ size: 6_149_000, type: "image/jpeg" });
    expect(message).toContain("6.1 MB");
    expect(message).toContain("4 MB");
    expect(message).toMatch(/photo/i);
    expect(isRetryablePhotoUploadFailure(message)).toBe(false);
  });

  it("gives PDF-specific advice", () => {
    const message = photoTooLargeMessage({ size: 9_000_000, type: "application/pdf" });
    expect(message).toMatch(/PDF/);
    expect(message).toMatch(/smaller PDF/i);
  });
});
