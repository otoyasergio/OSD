import { describe, expect, it } from "vitest";
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

  it("clears the input even when there is nothing to prepare", async () => {
    const input = fakeInput([]);
    await expect(readPickedPhotoFiles(input)).resolves.toEqual([]);
    expect(input.value).toBe("");
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
