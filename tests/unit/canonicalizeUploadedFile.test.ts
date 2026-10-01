import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { canonicalizeUploadedFile } from "@/lib/photos/canonicalizeUploadedFile";

function heifHeader(brand = "heic"): Buffer {
  const bytes = Buffer.alloc(32, 0);
  bytes.write("ftyp", 4, "ascii");
  bytes.write(brand, 8, "ascii");
  return bytes;
}

function pdfBytes(): Buffer {
  return Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
}

describe("canonicalizeUploadedFile", () => {
  it("canonicalizes raw HEIC bytes to JPEG even when the MIME is empty", async () => {
    const source = readFileSync(join(process.cwd(), "tests/fixtures/photos/sample.heic"));
    const result = await canonicalizeUploadedFile({
      bytes: source,
      declaredType: "",
      maxBytes: 10 * 1024 * 1024,
      allowPdf: true,
    });

    expect(result.contentType).toBe("image/jpeg");
    expect(result.extension).toBe("jpg");
    expect((await sharp(result.bytes).metadata()).format).toBe("jpeg");
    expect(result.byteSize).toBe(result.bytes.byteLength);
  });

  it("leaves a PDF unchanged and does not re-encode it", async () => {
    const source = pdfBytes();
    const result = await canonicalizeUploadedFile({
      bytes: source,
      declaredType: "application/octet-stream",
      maxBytes: 10 * 1024 * 1024,
      allowPdf: true,
    });

    expect(result.contentType).toBe("application/pdf");
    expect(result.extension).toBe("pdf");
    expect(Buffer.from(result.bytes).equals(source)).toBe(true);
  });

  it("rejects PDFs when the surface does not allow them", async () => {
    await expect(
      canonicalizeUploadedFile({
        bytes: pdfBytes(),
        declaredType: "application/pdf",
        maxBytes: 5 * 1024 * 1024,
        allowPdf: false,
      })
    ).rejects.toThrow("TYPE_INVALID");
  });

  it("validates by bytes, not the declared MIME, and rejects garbage labeled as JPEG", async () => {
    await expect(
      canonicalizeUploadedFile({
        bytes: Buffer.from("not-an-image"),
        declaredType: "image/jpeg",
        maxBytes: 5 * 1024 * 1024,
        allowPdf: false,
      })
    ).rejects.toThrow("TYPE_INVALID");
  });

  it("rejects empty and oversized sources with the existing size codes", async () => {
    await expect(
      canonicalizeUploadedFile({
        bytes: Buffer.alloc(0),
        declaredType: "image/jpeg",
        maxBytes: 5 * 1024 * 1024,
        allowPdf: false,
      })
    ).rejects.toThrow("REQUIRED");

    await expect(
      canonicalizeUploadedFile({
        bytes: Buffer.alloc(5 * 1024 * 1024 + 1, 0xff),
        declaredType: "image/jpeg",
        maxBytes: 5 * 1024 * 1024,
        allowPdf: false,
      })
    ).rejects.toThrow("TOO_LARGE");
  });

  it("rejects a truncated HEIC header as TYPE_INVALID", async () => {
    await expect(
      canonicalizeUploadedFile({
        bytes: heifHeader("heic"),
        declaredType: "image/heic",
        maxBytes: 10 * 1024 * 1024,
        allowPdf: true,
      })
    ).rejects.toThrow("TYPE_INVALID");
  });
});
