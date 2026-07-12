import { describe, expect, it } from "vitest";
import { compressImageForUpload } from "@/lib/forms/compressImageForUpload";

describe("compressImageForUpload", () => {
  it("returns the original file when it is already small enough", async () => {
    const small = new File(["tiny"], "shot.jpg", { type: "image/jpeg" });
    const result = await compressImageForUpload(small, { maxBytes: 1024 * 1024 });
    expect(result).toBe(small);
  });

  it("never returns an empty file", async () => {
    // A non-image blob should fall back to the original rather than blank output.
    const weird = new File(["not-an-image"], "notes.bin", {
      type: "application/octet-stream",
    });
    const result = await compressImageForUpload(weird, {
      maxBytes: 1,
      maxDimension: 64,
    });
    expect(result.size).toBeGreaterThan(0);
  });
});
