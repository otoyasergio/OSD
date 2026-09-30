import { describe, expect, it, vi } from "vitest";
import { isRetryablePhotoUploadFailure } from "@/lib/forms/photoUploadErrors";
import { withPhotoUploadRetries } from "@/lib/forms/retryPhotoUpload";
import { classifyStorageUploadError } from "@/lib/forms/storageUploadRetry";

describe("isRetryablePhotoUploadFailure", () => {
  it("retries transient storage and network errors", () => {
    expect(isRetryablePhotoUploadFailure("Could not upload the photo. Try again.")).toBe(
      true
    );
    expect(isRetryablePhotoUploadFailure("Failed to fetch")).toBe(true);
    expect(
      isRetryablePhotoUploadFailure("NetworkError when attempting to fetch resource.")
    ).toBe(true);
  });

  it("does not retry permanent validation errors", () => {
    expect(isRetryablePhotoUploadFailure("Photos must be 10 MB or smaller.")).toBe(false);
    expect(isRetryablePhotoUploadFailure("Use a JPEG, PNG, WebP, or HEIC image.")).toBe(
      false
    );
    expect(isRetryablePhotoUploadFailure("Choose a photo to upload.")).toBe(false);
  });
});

describe("withPhotoUploadRetries", () => {
  it("retries retryable failures then succeeds", async () => {
    let attempts = 0;
    const sleep = vi.fn(async () => undefined);

    const result = await withPhotoUploadRetries(
      async () => {
        attempts += 1;
        if (attempts < 3) return { error: "Could not upload the photo. Try again." };
        return { error: null };
      },
      {
        isSuccess: (value) => value.error === null,
        getFailureMessage: (value) => value.error,
        sleep,
      }
    );

    expect(result).toEqual({ error: null });
    expect(attempts).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("does not retry permanent errors", async () => {
    let attempts = 0;
    const result = await withPhotoUploadRetries(
      async () => {
        attempts += 1;
        return { error: "Photos must be 10 MB or smaller." };
      },
      {
        isSuccess: (value) => value.error === null,
        getFailureMessage: (value) => value.error,
        sleep: async () => undefined,
      }
    );

    expect(result.error).toMatch(/10 MB/);
    expect(attempts).toBe(1);
  });
});

describe("classifyStorageUploadError", () => {
  it("treats a missing error as success", () => {
    expect(classifyStorageUploadError(null)).toBe("ok");
  });

  it("treats duplicate objects as already uploaded", () => {
    expect(classifyStorageUploadError({ statusCode: 409, message: "Duplicate" })).toBe(
      "exists"
    );
    expect(classifyStorageUploadError({ message: "The resource already exists" })).toBe(
      "exists"
    );
  });

  it("does not retry oversized payloads", () => {
    expect(classifyStorageUploadError({ statusCode: "413" })).toBe("fail");
  });

  it("retries other storage failures", () => {
    expect(
      classifyStorageUploadError({ message: "internal error", statusCode: 500 })
    ).toBe("retry");
  });
});
