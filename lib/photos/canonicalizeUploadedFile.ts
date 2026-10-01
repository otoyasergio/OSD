import { sniffAllowedUploadMime } from "@/lib/forms/imageMime";
import { canonicalizeIntakePhoto } from "@/lib/photos/canonicalizeIntakePhoto";

export type CanonicalizedUpload = {
  bytes: Buffer;
  contentType: "image/jpeg" | "application/pdf";
  extension: "jpg" | "pdf";
  byteSize: number;
};

export type CanonicalizeUploadedFileInput = {
  bytes: Uint8Array;
  declaredType?: string;
  maxBytes: number;
  allowPdf: boolean;
};

function mapCanonicalError(error: unknown): never {
  if (error instanceof Error) {
    if (error.message === "PHOTO_REQUIRED" || error.message === "REQUIRED") {
      throw new Error("REQUIRED");
    }
    if (error.message === "PHOTO_TOO_LARGE" || error.message === "TOO_LARGE") {
      throw new Error("TOO_LARGE");
    }
  }
  throw new Error("TYPE_INVALID");
}

/**
 * Validate upload bytes (not MIME) and canonicalize images to JPEG.
 * PDFs stay PDFs when allowed. Raw HEIC falls back through the intake
 * canonicalizer.
 */
export async function canonicalizeUploadedFile(
  input: CanonicalizeUploadedFileInput
): Promise<CanonicalizedUpload> {
  const { bytes, maxBytes, allowPdf } = input;
  if (bytes.byteLength === 0) throw new Error("REQUIRED");
  if (bytes.byteLength > maxBytes) throw new Error("TOO_LARGE");

  const sniffed = sniffAllowedUploadMime(bytes);
  if (sniffed === "application/pdf") {
    if (!allowPdf) throw new Error("TYPE_INVALID");
    const copy = Buffer.from(bytes);
    return {
      bytes: copy,
      contentType: "application/pdf",
      extension: "pdf",
      byteSize: copy.byteLength,
    };
  }

  if (!sniffed) throw new Error("TYPE_INVALID");

  try {
    const canonical = await canonicalizeIntakePhoto(bytes);
    return {
      bytes: canonical.bytes,
      contentType: "image/jpeg",
      extension: "jpg",
      byteSize: canonical.byteSize,
    };
  } catch (error) {
    mapCanonicalError(error);
  }
}
