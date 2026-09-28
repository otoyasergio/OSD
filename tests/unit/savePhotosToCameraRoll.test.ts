import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isCameraPhotoInput,
  savePhotosToCameraRoll,
} from "@/lib/forms/savePhotosToCameraRoll";

const jpeg = new File(["tiny-jpeg-bytes"], "shot.jpg", { type: "image/jpeg" });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isCameraPhotoInput", () => {
  it("is true only when the input is the camera capture control", () => {
    const camera = { capture: "environment", hasAttribute: () => true };
    const library = { capture: "", hasAttribute: () => false };
    expect(isCameraPhotoInput(camera as unknown as HTMLInputElement)).toBe(true);
    expect(isCameraPhotoInput(library as unknown as HTMLInputElement)).toBe(false);
  });
});

describe("savePhotosToCameraRoll", () => {
  it("opens the native share sheet so iOS can Save to Photos", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const download = vi.fn();

    await savePhotosToCameraRoll([jpeg], {
      canShare: () => true,
      share,
      download,
    });

    expect(share).toHaveBeenCalledTimes(1);
    expect(share.mock.calls[0][0].files).toEqual([jpeg]);
    expect(download).not.toHaveBeenCalled();
  });

  it("downloads when the device cannot share files", async () => {
    const download = vi.fn();

    await savePhotosToCameraRoll([jpeg], {
      canShare: () => false,
      share: vi.fn(),
      download,
    });

    expect(download).toHaveBeenCalledWith(jpeg);
  });

  it("does not download when the user dismisses the share sheet", async () => {
    const abort = Object.assign(new Error("Share canceled"), { name: "AbortError" });
    const download = vi.fn();

    await savePhotosToCameraRoll([jpeg], {
      canShare: () => true,
      share: vi.fn().mockRejectedValue(abort),
      download,
    });

    expect(download).not.toHaveBeenCalled();
  });

  it("does nothing when there are no files", async () => {
    const share = vi.fn();
    const download = vi.fn();
    await savePhotosToCameraRoll([], { canShare: () => true, share, download });
    expect(share).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });
});
