import { parseAamvaLicence, type LicenceScan } from "@/lib/id/aamva";

/**
 * Plain text keeps the AAMVA separators. ZXing's default "HRI" mode prints
 * them as `<LF>`, `<CR>`, and `<RS>`, which is not the licence payload.
 */
const READER_OPTIONS = {
  formats: ["PDF417"],
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: true,
  tryDenoise: true,
  textMode: "Plain",
  maxNumberOfSymbols: 1,
} as const;

type BarcodeHit = { text?: string; error?: string };

function firstScan(rows: BarcodeHit[]): LicenceScan | null {
  for (const row of rows) {
    if (row.error || !row.text) continue;
    const scan = parseAamvaLicence(row.text);
    if (scan) return scan;
  }
  return null;
}

function imageFailedToLoad(rows: BarcodeHit[]): boolean {
  return rows.length > 0 && rows.every((row) => Boolean(row.error) && !row.text);
}

function bytesToBlob(input: Uint8Array): Blob {
  const bytes = new ArrayBuffer(input.byteLength);
  new Uint8Array(bytes).set(input);
  return new Blob([bytes]);
}

async function rasterize(input: Blob | Uint8Array): Promise<ImageData | null> {
  if (typeof document === "undefined" || typeof createImageBitmap !== "function")
    return null;
  const blob = input instanceof Blob ? input : bytesToBlob(input);
  try {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      bitmap.close?.();
      return null;
    }
    context.drawImage(bitmap, 0, 0);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    return image;
  } catch {
    return null;
  }
}

export async function readLicenceBarcode(
  input: Blob | Uint8Array | ArrayBuffer | ImageData
): Promise<LicenceScan | null> {
  const { readBarcodes } = await import("zxing-wasm/reader");
  const rows = await readBarcodes(input, {
    ...READER_OPTIONS,
    formats: [...READER_OPTIONS.formats],
  });
  const scan = firstScan(rows);
  if (scan) return scan;
  if (input instanceof ImageData || !imageFailedToLoad(rows)) return null;
  const pixels = await rasterize(
    input instanceof ArrayBuffer ? new Uint8Array(input) : input
  );
  if (!pixels) return null;
  return firstScan(
    await readBarcodes(pixels, {
      ...READER_OPTIONS,
      formats: [...READER_OPTIONS.formats],
    })
  );
}
