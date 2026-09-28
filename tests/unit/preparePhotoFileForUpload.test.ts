import { describe, expect, it } from "vitest";
import { preparePhotoFileForUpload } from "@/lib/forms/preparePhotoFileForUpload";

const JPEG_HEADER = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

function heicHeader(): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(16);
  bytes.set([0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63], 4);
  return bytes;
}

/** iOS photo-library File: size stays 0 until the bytes are actually read. */
function libraryFileReportingSizeZero(
  bytes: Uint8Array<ArrayBuffer>,
  name: string,
  type = ""
): File {
  const file = new File([bytes], name, { type });
  Object.defineProperty(file, "size", { configurable: true, value: 0 });
  return file;
}

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

  it("reads library files that report size 0 until they are opened", async () => {
    const original = libraryFileReportingSizeZero(JPEG_HEADER, "IMG_1234.HEIC");

    const prepared = await preparePhotoFileForUpload(original);

    expect(prepared).not.toBe(original);
    expect(prepared.size).toBe(JPEG_HEADER.byteLength);
    expect(prepared.type).toBe("image/jpeg");
    expect(new Uint8Array(await prepared.arrayBuffer())).toEqual(JPEG_HEADER);
  });

  it("names an unnamed library photo so the server does not drop it", async () => {
    const original = new File([JPEG_HEADER], "", { type: "" });

    const prepared = await preparePhotoFileForUpload(original);

    expect(prepared.name).toMatch(/\.jpe?g$/i);
    expect(prepared.name.length).toBeGreaterThan(0);
    expect(prepared.type).toBe("image/jpeg");
  });

  it("keeps HEIC bytes labeled as HEIC when the picker leaves type empty", async () => {
    const original = libraryFileReportingSizeZero(heicHeader(), "IMG_0001.HEIC");

    const prepared = await preparePhotoFileForUpload(original);

    expect(prepared.type).toBe("image/heic");
    expect(prepared.size).toBeGreaterThan(0);
    expect(prepared.name.toLowerCase()).toContain("img_0001");
  });
});
