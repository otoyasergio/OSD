import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { countInkPixels, signatureHasEnoughInk } from "@/lib/inspections/signatureInk";
import { assertSignatureHasInk } from "@/lib/services/inspectionSignatures";

async function pngFromPixels(inkPixels: number): Promise<Buffer> {
  const width = 40;
  const height = 20;
  const raw = Buffer.alloc(width * height * 4, 0);
  for (let pixel = 0; pixel < inkPixels; pixel += 1) {
    const offset = pixel * 4;
    raw[offset] = 17;
    raw[offset + 1] = 17;
    raw[offset + 2] = 17;
    raw[offset + 3] = 255;
  }
  return sharp(raw, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}

describe("signature ink", () => {
  it("rejects a blank pad and a single dot", () => {
    expect(signatureHasEnoughInk([0, 0, 0, 0, 0, 0, 0, 255])).toBe(false);
    const dot = new Uint8ClampedArray(12 * 4);
    for (let pixel = 0; pixel < 12; pixel += 1) {
      dot[pixel * 4 + 3] = 255;
    }
    expect(countInkPixels(dot)).toBe(12);
    expect(signatureHasEnoughInk(dot)).toBe(false);
  });

  it("rejects a transparent PNG and accepts a drawn stroke", async () => {
    const blank = await sharp({
      create: {
        width: 20,
        height: 20,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
    await expect(assertSignatureHasInk(blank)).rejects.toThrow("SIGNATURE_REQUIRED");

    const signed = await pngFromPixels(120);
    await expect(assertSignatureHasInk(signed)).resolves.toBeUndefined();
  });
});
