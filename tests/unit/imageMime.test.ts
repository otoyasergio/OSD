import { describe, expect, it } from "vitest";
import { sniffImageMime, usablePhotoName } from "@/lib/forms/imageMime";

describe("sniffImageMime", () => {
  it("detects JPEG, PNG, WebP, and HEIC from magic bytes", () => {
    expect(sniffImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))).toBe(
      "image/png"
    );

    const webp = new Uint8Array(12);
    webp.set([0x52, 0x49, 0x46, 0x46], 0);
    webp.set([0x57, 0x45, 0x42, 0x50], 8);
    expect(sniffImageMime(webp)).toBe("image/webp");

    const heic = new Uint8Array(12);
    heic.set([0x66, 0x74, 0x79, 0x70, 0x6d, 0x69, 0x66, 0x31], 4);
    expect(sniffImageMime(heic)).toBe("image/heic");
  });

  it("returns null when the bytes are not a known image", () => {
    expect(sniffImageMime(new Uint8Array([0x00, 0x01, 0x02]))).toBeNull();
  });
});

describe("usablePhotoName", () => {
  it("keeps a real filename and replaces empty or undefined names", () => {
    expect(usablePhotoName("IMG_1.HEIC", "image/heic")).toBe("IMG_1.HEIC");
    expect(usablePhotoName("", "image/jpeg")).toBe("photo.jpg");
    expect(usablePhotoName("undefined", "image/heic")).toBe("photo.heic");
    expect(usablePhotoName("  ", "application/pdf")).toBe("document.pdf");
  });
});
