import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  INTAKE_THUMB_MAX_EDGE,
  intakeThumbStoragePath,
  makeIntakeThumb,
} from "@/lib/photos/makeIntakeThumb";

describe("makeIntakeThumb", () => {
  it("shrinks a large JPEG to the preview edge", async () => {
    const original = await sharp({
      create: { width: 2000, height: 1500, channels: 3, background: "#334155" },
    })
      .jpeg()
      .toBuffer();

    const thumb = await makeIntakeThumb(original);
    expect(thumb).not.toBeNull();
    const meta = await sharp(thumb!).metadata();
    expect(meta.width).toBeLessThanOrEqual(INTAKE_THUMB_MAX_EDGE);
    expect(meta.height).toBeLessThanOrEqual(INTAKE_THUMB_MAX_EDGE);
    expect(thumb!.byteLength).toBeLessThan(original.byteLength);
  });

  it("maps the original storage path to a sibling .thumb.jpg", () => {
    expect(intakeThumbStoragePath("wo/front/abc.jpg")).toBe("wo/front/abc.thumb.jpg");
    expect(intakeThumbStoragePath("wo/front/abc")).toBe("wo/front/abc.thumb.jpg");
  });
});
