import { describe, expect, it } from "vitest";
import { preparePhotoFileForUpload } from "@/lib/forms/preparePhotoFileForUpload";

describe("preparePhotoFileForUpload", () => {
  it("returns a new File instance so clearing the input cannot invalidate the upload", async () => {
    const original = new File(["tiny-jpeg-bytes"], "library.jpg", {
      type: "image/jpeg",
    });

    const prepared = await preparePhotoFileForUpload(original);

    expect(prepared).toBeInstanceOf(File);
    expect(prepared).not.toBe(original);
    expect(prepared.size).toBeGreaterThan(0);
    expect(prepared.type).toBe("image/jpeg");
  });

  it("preserves bytes when the source is already a small JPEG", async () => {
    const original = new File(["tiny-jpeg-bytes"], "library.jpg", {
      type: "image/jpeg",
    });

    const prepared = await preparePhotoFileForUpload(original);

    expect(await prepared.text()).toBe("tiny-jpeg-bytes");
    expect(prepared.name).toBe("library.jpg");
  });
});
