import { describe, expect, it, vi } from "vitest";
import { removeIntakePhotoObjects } from "@/lib/photos/removeIntakePhotoObjects";

const PATHS = [
  "41111111-1111-4111-8111-111111111111/front/photo.jpg",
  "41111111-1111-4111-8111-111111111111/front/photo.thumb.jpg",
];

describe("removeIntakePhotoObjects", () => {
  it("inspects a returned storage error and surfaces PHOTO_UPLOAD_FAILED", async () => {
    const remove = vi.fn(async () => ({
      error: { message: "https://signed.example/private.jpg", statusCode: 403 },
    }));
    const logFailure = vi.fn();

    await expect(
      removeIntakePhotoObjects({
        remove,
        paths: PATHS,
        logFailure,
        sleep: async () => undefined,
      })
    ).rejects.toThrow("PHOTO_UPLOAD_FAILED");
    expect(remove).toHaveBeenCalledWith(PATHS);
    expect(logFailure).toHaveBeenCalledWith({
      stage: "cleanup",
      pathCount: 2,
      statusCode: "403",
    });
    expect(JSON.stringify(logFailure.mock.calls)).not.toContain("signed.example");
  });

  it("retries a classifiable transient error then succeeds", async () => {
    const remove = vi
      .fn()
      .mockResolvedValueOnce({ error: { message: "internal error", statusCode: 500 } })
      .mockResolvedValueOnce({ error: null });
    const sleep = vi.fn(async () => undefined);

    await removeIntakePhotoObjects({
      remove,
      paths: PATHS,
      logFailure: vi.fn(),
      sleep,
    });

    expect(remove).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("does not treat a leftover cleanup error as success", async () => {
    const remove = vi.fn(async () => ({
      error: { message: "timeout", statusCode: 504 },
    }));

    await expect(
      removeIntakePhotoObjects({
        remove,
        paths: PATHS,
        logFailure: vi.fn(),
        sleep: async () => undefined,
        retryAttempts: 2,
      })
    ).rejects.toThrow("PHOTO_UPLOAD_FAILED");
    expect(remove).toHaveBeenCalledTimes(2);
  });
});
