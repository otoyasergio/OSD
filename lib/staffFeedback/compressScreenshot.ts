import "server-only";

import sharp from "sharp";
import {
  STAFF_FEEDBACK_SCREENSHOT_MAX_BYTES,
  STAFF_FEEDBACK_SCREENSHOT_MAX_EDGE,
  STAFF_FEEDBACK_SCREENSHOT_SOURCE_MAX_BYTES,
} from "@/lib/staffFeedback/constants";

const PASSES = [
  { edge: STAFF_FEEDBACK_SCREENSHOT_MAX_EDGE, quality: 60 },
  { edge: 1100, quality: 45 },
  { edge: 800, quality: 35 },
] as const;

export async function compressStaffFeedbackScreenshot(source: Uint8Array): Promise<{
  bytes: Buffer;
  contentType: "image/jpeg";
}> {
  if (source.byteLength === 0) throw new Error("STAFF_FEEDBACK_SCREENSHOT_INVALID");
  if (source.byteLength > STAFF_FEEDBACK_SCREENSHOT_SOURCE_MAX_BYTES) {
    throw new Error("STAFF_FEEDBACK_SCREENSHOT_TOO_LARGE");
  }

  try {
    const metadata = await sharp(source, { failOn: "error" }).metadata();
    if (!metadata.format || !metadata.width || !metadata.height) {
      throw new Error("STAFF_FEEDBACK_SCREENSHOT_INVALID");
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("STAFF_FEEDBACK_"))
      throw error;
    throw new Error("STAFF_FEEDBACK_SCREENSHOT_INVALID");
  }

  for (const pass of PASSES) {
    const encoded = await sharp(source, { failOn: "error" })
      .rotate()
      .resize(pass.edge, pass.edge, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: pass.quality, mozjpeg: true })
      .toBuffer();
    if (encoded.byteLength <= STAFF_FEEDBACK_SCREENSHOT_MAX_BYTES) {
      return { bytes: encoded, contentType: "image/jpeg" };
    }
  }

  throw new Error("STAFF_FEEDBACK_SCREENSHOT_TOO_LARGE");
}
