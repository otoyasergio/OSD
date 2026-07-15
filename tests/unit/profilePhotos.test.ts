import { describe, expect, it } from "vitest";
import {
  PROFILE_PHOTO_MAX_BYTES,
  profilePhotoExtension,
} from "@/lib/profilePhotos/storage";
import { validateProfilePhotoMetadata } from "@/lib/services/profilePhotos";

describe("profile photo validation", () => {
  it("accepts supported images within the size limit", () => {
    expect(() =>
      validateProfilePhotoMetadata({ size: 1024, type: "image/jpeg" })
    ).not.toThrow();
  });

  it("requires a non-empty file", () => {
    expect(() => validateProfilePhotoMetadata({ size: 0, type: "image/png" })).toThrow(
      "PROFILE_PHOTO_REQUIRED"
    );
  });

  it("rejects files over 5 MB", () => {
    expect(() =>
      validateProfilePhotoMetadata({
        size: PROFILE_PHOTO_MAX_BYTES + 1,
        type: "image/png",
      })
    ).toThrow("PROFILE_PHOTO_TOO_LARGE");
  });

  it("rejects unsupported image types", () => {
    expect(() => validateProfilePhotoMetadata({ size: 1024, type: "image/gif" })).toThrow(
      "PROFILE_PHOTO_TYPE_INVALID"
    );
  });

  it("maps supported MIME types to safe extensions", () => {
    expect(profilePhotoExtension("image/jpeg")).toBe("jpg");
    expect(profilePhotoExtension("image/png")).toBe("png");
    expect(profilePhotoExtension("image/webp")).toBe("webp");
  });
});
