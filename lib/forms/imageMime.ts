const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "mif1", "msf1", "heif"]);

/**
 * Detect image MIME from magic bytes. iOS photo-library File.type is often "".
 */
export function sniffImageMime(bytes: ArrayBuffer | Uint8Array): string | null {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length >= 3 && u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    u8.length >= 8 &&
    u8[0] === 0x89 &&
    u8[1] === 0x50 &&
    u8[2] === 0x4e &&
    u8[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    u8.length >= 12 &&
    u8[0] === 0x52 &&
    u8[1] === 0x49 &&
    u8[2] === 0x46 &&
    u8[3] === 0x46 &&
    u8[8] === 0x57 &&
    u8[9] === 0x45 &&
    u8[10] === 0x42 &&
    u8[11] === 0x50
  ) {
    return "image/webp";
  }
  if (u8.length >= 12) {
    const box = String.fromCharCode(u8[4], u8[5], u8[6], u8[7]);
    if (box === "ftyp") {
      const brand = String.fromCharCode(u8[8], u8[9], u8[10], u8[11]).toLowerCase();
      if (HEIC_BRANDS.has(brand)) return "image/heic";
    }
  }
  return null;
}

/** Fallback filename when iOS leaves File.name empty or "undefined". */
export function usablePhotoName(name: string | undefined, type: string): string {
  const trimmed = (name ?? "").trim();
  if (trimmed && trimmed !== "undefined") return trimmed;
  if (type === "application/pdf") return "document.pdf";
  if (type === "image/png") return "photo.png";
  if (type === "image/webp") return "photo.webp";
  if (type === "image/heic" || type === "image/heif") return "photo.heic";
  return "photo.jpg";
}
