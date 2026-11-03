/** Minimum dark pixels that count as a drawn signature, not a tap or a blank pad. */
export const SIGNATURE_MIN_INK_PIXELS = 80;

/**
 * Count pixels that are visibly dark. Transparent and near-white pixels do not
 * count, so an empty canvas or a single dot fails.
 */
export function countInkPixels(data: ArrayLike<number>, channels = 4): number {
  let ink = 0;
  for (let i = 0; i + 3 < data.length; i += channels) {
    const alpha = data[i + 3] ?? 0;
    const red = data[i] ?? 255;
    const green = data[i + 1] ?? 255;
    const blue = data[i + 2] ?? 255;
    if (alpha > 24 && red < 245 && green < 245 && blue < 245) ink += 1;
  }
  return ink;
}

export function signatureHasEnoughInk(data: ArrayLike<number>, channels = 4): boolean {
  return countInkPixels(data, channels) >= SIGNATURE_MIN_INK_PIXELS;
}
