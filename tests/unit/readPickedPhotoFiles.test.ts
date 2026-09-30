import { describe, expect, it, vi } from "vitest";
import { preparePhotoFileForUpload } from "@/lib/forms/preparePhotoFileForUpload";
import { readPickedPhotoFiles } from "@/lib/forms/readPickedPhotoFiles";

function fakeInput(files: File[]): HTMLInputElement {
  return {
    files,
    value: "C:\\fakepath\\library.jpg",
  } as unknown as HTMLInputElement;
}

describe("readPickedPhotoFiles", () => {
  it("returns cloned files and clears the input so iOS library refs stay readable", async () => {
    const original = new File(["tiny-jpeg-bytes"], "library.jpg", {
      type: "image/jpeg",
    });
    const input = fakeInput([original]);

    const prepared = await readPickedPhotoFiles(input);

    expect(prepared).toHaveLength(1);
    expect(prepared[0]).not.toBe(original);
    expect(await prepared[0].text()).toBe("tiny-jpeg-bytes");
    expect(input.value).toBe("");
  });

  it("skips empty files", async () => {
    const empty = new File([], "empty.jpg", { type: "image/jpeg" });
    const usable = new File(["ok"], "shot.jpg", { type: "image/jpeg" });
    const input = fakeInput([empty, usable]);

    const prepared = await readPickedPhotoFiles(input);

    expect(prepared).toHaveLength(1);
    expect(prepared[0].name).toBe("shot.jpg");
    expect(input.value).toBe("");
  });

  it("keeps library files that report size 0 until they are read", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const sneaky = new File([bytes], "IMG_1234.HEIC", { type: "" });
    Object.defineProperty(sneaky, "size", { configurable: true, value: 0 });
    const input = fakeInput([sneaky]);

    const prepared = await readPickedPhotoFiles(input);

    expect(prepared).toHaveLength(1);
    expect(prepared[0]).not.toBe(sneaky);
    expect(prepared[0].size).toBe(bytes.byteLength);
    expect(input.value).toBe("");
  });

  it("clears the input even when there is nothing to prepare", async () => {
    const input = fakeInput([]);
    await expect(readPickedPhotoFiles(input)).resolves.toEqual([]);
    expect(input.value).toBe("");
  });

  it("archives camera captures to the device before clearing the input", async () => {
    const original = new File(["tiny-jpeg-bytes"], "shot.jpg", {
      type: "image/jpeg",
    });
    const input = {
      ...fakeInput([original]),
      capture: "environment",
    } as unknown as HTMLInputElement;
    const savePhotos = vi.fn().mockResolvedValue(undefined);

    const prepared = await readPickedPhotoFiles(input, { savePhotos });

    expect(savePhotos).toHaveBeenCalledTimes(1);
    expect(savePhotos.mock.calls[0][0]).toEqual([original]);
    expect(prepared[0]).not.toBe(original);
    await vi.waitFor(() => {
      expect(input.value).toBe("");
    });
  });

  it("returns photos for upload without waiting for the device save sheet", async () => {
    let release: () => void = () => {};
    const savePhotos = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    const original = new File(["tiny-jpeg-bytes"], "shot.jpg", {
      type: "image/jpeg",
    });
    const input = {
      ...fakeInput([original]),
      capture: "environment",
    } as unknown as HTMLInputElement;

    const prepared = await readPickedPhotoFiles(input, { savePhotos });

    expect(prepared).toHaveLength(1);
    expect(prepared[0]).not.toBe(original);
    expect(savePhotos).toHaveBeenCalledWith([original]);
    expect(input.value).not.toBe("");

    release();
    await vi.waitFor(() => {
      expect(input.value).toBe("");
    });
  });

  it("does not archive library picks — those are already on the device", async () => {
    const original = new File(["tiny-jpeg-bytes"], "library.jpg", {
      type: "image/jpeg",
    });
    const input = fakeInput([original]);
    const savePhotos = vi.fn();

    await readPickedPhotoFiles(input, { savePhotos });

    expect(savePhotos).not.toHaveBeenCalled();
  });
});

describe("preparePhotoFileForUpload", () => {
  it("throws a readable error when the file cannot be cloned", async () => {
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

    await expect(preparePhotoFileForUpload(unreadable)).rejects.toThrow(
      /could not read that photo/i
    );
  });
});
