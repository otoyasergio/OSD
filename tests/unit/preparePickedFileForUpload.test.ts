import { describe, expect, it } from "vitest";
import { UNREADABLE_PHOTO_MESSAGE } from "@/lib/forms/photoUploadErrors";
import { preparePickedFileForUpload } from "@/lib/forms/preparePickedFileForUpload";
import { readPickedUploadFiles } from "@/lib/forms/readPickedUploadFiles";

const JPEG_HEADER = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PDF_HEADER = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

function heicHeader(): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(16);
  bytes.set([0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63], 4);
  return bytes;
}

function libraryFileReportingSizeZero(
  bytes: Uint8Array<ArrayBuffer>,
  name: string,
  type = ""
): File {
  const file = new File([bytes], name, { type });
  Object.defineProperty(file, "size", { configurable: true, value: 0 });
  return file;
}

function fakeInput(files: File[]): HTMLInputElement {
  return {
    files,
    value: "C:\\fakepath\\library.jpg",
  } as unknown as HTMLInputElement;
}

describe("preparePickedFileForUpload", () => {
  it("clones a PDF into an independent File before the picker can reset", async () => {
    const original = libraryFileReportingSizeZero(PDF_HEADER, "card.pdf", "");

    const prepared = await preparePickedFileForUpload(original);

    expect(prepared).toBeInstanceOf(File);
    expect(prepared).not.toBe(original);
    expect(prepared.type).toBe("application/pdf");
    expect(prepared.name.toLowerCase()).toMatch(/\.pdf$/);
    expect(new Uint8Array(await prepared.arrayBuffer())).toEqual(PDF_HEADER);
  });

  it("prepares an image through the photo helper and returns a new File", async () => {
    const original = libraryFileReportingSizeZero(JPEG_HEADER, "IMG_1234.HEIC");

    const prepared = await preparePickedFileForUpload(original);

    expect(prepared).not.toBe(original);
    expect(prepared.size).toBe(JPEG_HEADER.byteLength);
    expect(prepared.type).toBe("image/jpeg");
  });

  it("keeps HEIC bytes labeled HEIC when the browser cannot convert", async () => {
    const original = libraryFileReportingSizeZero(heicHeader(), "IMG_0001.HEIC");

    const prepared = await preparePickedFileForUpload(original);

    expect(prepared.type).toBe("image/heic");
    expect(prepared.size).toBeGreaterThan(0);
  });

  it("rejects empty iOS files with the safe unreadable copy", async () => {
    const empty = new File([], "empty.jpg", { type: "image/jpeg" });

    await expect(preparePickedFileForUpload(empty)).rejects.toThrow(
      UNREADABLE_PHOTO_MESSAGE
    );
  });

  it("rejects unreadable iOS files with the safe unreadable copy", async () => {
    const unreadable = {
      name: "library.jpg",
      size: 12,
      type: "image/jpeg",
      lastModified: 1,
      arrayBuffer: async () => {
        throw new Error("NotReadableError");
      },
    } as unknown as File;
    Object.setPrototypeOf(unreadable, File.prototype);

    await expect(preparePickedFileForUpload(unreadable)).rejects.toThrow(
      UNREADABLE_PHOTO_MESSAGE
    );
  });

  it("rejects non-image, non-PDF bytes even when the MIME is forged", async () => {
    const forged = new File([new Uint8Array([0x00, 0x01, 0x02, 0x03])], "virus.pdf", {
      type: "application/pdf",
    });

    await expect(preparePickedFileForUpload(forged)).rejects.toThrow(
      UNREADABLE_PHOTO_MESSAGE
    );
  });
});

describe("readPickedUploadFiles", () => {
  it("clones a PDF and an image before clearing the input", async () => {
    const pdf = new File([PDF_HEADER], "card.pdf", { type: "application/pdf" });
    const jpeg = new File([JPEG_HEADER], "shot.jpg", { type: "image/jpeg" });
    const input = fakeInput([pdf, jpeg]);

    const prepared = await readPickedUploadFiles(input);

    expect(prepared).toHaveLength(2);
    expect(prepared[0]).not.toBe(pdf);
    expect(prepared[1]).not.toBe(jpeg);
    expect(prepared[0].type).toBe("application/pdf");
    expect(prepared[1].type).toBe("image/jpeg");
    expect(await prepared[0].arrayBuffer()).toEqual(PDF_HEADER.buffer);
    expect(input.value).toBe("");
  });

  it("throws the safe unreadable copy when every picked file is empty", async () => {
    const input = fakeInput([new File([], "empty.pdf", { type: "application/pdf" })]);

    await expect(readPickedUploadFiles(input)).rejects.toThrow(UNREADABLE_PHOTO_MESSAGE);
    expect(input.value).toBe("");
  });

  it("clears the input after a successful clone even for a size-zero library PDF", async () => {
    const sneaky = libraryFileReportingSizeZero(PDF_HEADER, "scan.PDF");
    const input = fakeInput([sneaky]);

    const prepared = await readPickedUploadFiles(input);

    expect(prepared).toHaveLength(1);
    expect(prepared[0]).not.toBe(sneaky);
    expect(prepared[0].type).toBe("application/pdf");
    expect(input.value).toBe("");
  });
});
