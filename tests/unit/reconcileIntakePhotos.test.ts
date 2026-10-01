import { describe, expect, it, vi } from "vitest";
import { intakeThumbStoragePath } from "@/lib/photos/makeIntakeThumb";
import {
  reconcileIntakePhotos,
  type PhotoReconcileDependencies,
  type PhotoReconcileRow,
  type StorageListItem,
} from "@/lib/photos/reconcileIntakePhotos";

const WO_A = "41111111-1111-4111-8111-111111111111";
const WO_B = "42111111-1111-4111-8111-111111111111";
const PHOTO_A = "71111111-1111-4111-8111-111111111111";
const PHOTO_B = "72111111-1111-4111-8111-111111111111";
const PHOTO_C = "73111111-1111-4111-8111-111111111111";
const PHOTO_D = "74111111-1111-4111-8111-111111111111";

function row(
  photoId: string,
  workOrderId: string,
  category: string,
  thumb: string | null
): PhotoReconcileRow {
  const storagePath = `${workOrderId}/${category}/${photoId}.jpg`;
  return {
    photo_id: photoId,
    storage_path: storagePath,
    thumb_storage_path: thumb,
  };
}

function folder(name: string): StorageListItem {
  return { name, id: null };
}

function file(name: string): StorageListItem {
  return { name, id: `${name}-id` };
}

describe("reconcileIntakePhotos report", () => {
  it("paginates rows and nested storage folders, then classifies without writes", async () => {
    const rows = [
      row(PHOTO_A, WO_A, "front", `${WO_A}/front/${PHOTO_A}.thumb.jpg`),
      row(PHOTO_B, WO_A, "rear", `${WO_A}/rear/${PHOTO_B}.thumb.jpg`),
      row(PHOTO_C, WO_B, "vin", null),
      row(PHOTO_D, WO_B, "odometer", `${WO_B}/odometer/${PHOTO_D}.thumb.jpg`),
    ];
    const listPhotoPage = vi.fn(async (offset: number, limit: number) =>
      rows.slice(offset, offset + limit)
    );

    const storage: Record<string, StorageListItem[]> = {
      "": [folder(WO_A), folder(WO_B), folder("extra-wo")],
      [WO_A]: [folder("front"), folder("rear")],
      [`${WO_A}/front`]: [file(`${PHOTO_A}.jpg`), file(`${PHOTO_A}.thumb.jpg`)],
      [`${WO_A}/rear`]: [file(`${PHOTO_B}.jpg`)],
      [WO_B]: [folder("vin"), folder("odometer")],
      [`${WO_B}/vin`]: [file(`${PHOTO_C}.jpg`), file(`${PHOTO_C}.thumb.jpg`)],
      [`${WO_B}/odometer`]: [],
      ["extra-wo"]: [folder("other")],
      ["extra-wo/other"]: [file("orphan.jpg")],
    };

    const listStoragePage = vi.fn(
      async (prefix: string, offset: number, limit: number) => {
        const items = storage[prefix] ?? [];
        return items.slice(offset, offset + limit);
      }
    );

    const downloadObject = vi.fn();
    const uploadObject = vi.fn();
    const updateThumbStoragePath = vi.fn();
    const generateThumbnail = vi.fn();
    const removeObject = vi.fn();

    const report = await reconcileIntakePhotos(
      {
        listPhotoPage,
        listStoragePage,
        downloadObject,
        uploadObject,
        updateThumbStoragePath,
        generateThumbnail,
        removeObject,
      },
      { pageSize: 2 }
    );

    expect(listPhotoPage.mock.calls.map((call) => [call[0], call[1]])).toEqual([
      [0, 2],
      [2, 2],
      [4, 2],
    ]);
    expect(listStoragePage).toHaveBeenCalledWith("", 0, 2);
    expect(listStoragePage).toHaveBeenCalledWith("", 2, 2);
    expect(listStoragePage).toHaveBeenCalledWith(WO_A, 0, 2);
    expect(listStoragePage).toHaveBeenCalledWith(`${WO_A}/front`, 0, 2);

    expect(report.missingOriginals).toEqual([
      { photoId: PHOTO_D, storagePath: `${WO_B}/odometer/${PHOTO_D}.jpg` },
    ]);
    expect(report.missingThumbnails).toEqual([
      {
        photoId: PHOTO_B,
        thumbStoragePath: `${WO_A}/rear/${PHOTO_B}.thumb.jpg`,
      },
      {
        photoId: PHOTO_D,
        thumbStoragePath: `${WO_B}/odometer/${PHOTO_D}.thumb.jpg`,
      },
    ]);
    expect(report.nullThumbnails).toEqual([
      { photoId: PHOTO_C, storagePath: `${WO_B}/vin/${PHOTO_C}.jpg` },
    ]);
    expect(report.orphans).toEqual([
      { path: `${WO_B}/vin/${PHOTO_C}.thumb.jpg` },
      { path: "extra-wo/other/orphan.jpg" },
    ]);
    expect(report.counts).toMatchObject({
      rows: 4,
      missingOriginals: 1,
      missingThumbnails: 2,
      nullThumbnails: 1,
      orphans: 2,
      repaired: 0,
      failed: 0,
    });
    expect(downloadObject).not.toHaveBeenCalled();
    expect(uploadObject).not.toHaveBeenCalled();
    expect(updateThumbStoragePath).not.toHaveBeenCalled();
    expect(generateThumbnail).not.toHaveBeenCalled();
    expect(removeObject).not.toHaveBeenCalled();
  });

  it("never invokes download, upload, update, or remove in read-only mode", async () => {
    const deps: PhotoReconcileDependencies = {
      listPhotoPage: async () => [row(PHOTO_A, WO_A, "front", null)],
      listStoragePage: async (prefix) => {
        if (prefix === "") return [folder(WO_A)];
        if (prefix === WO_A) return [folder("front")];
        if (prefix === `${WO_A}/front`) return [file(`${PHOTO_A}.jpg`)];
        return [];
      },
      downloadObject: vi.fn(),
      uploadObject: vi.fn(),
      updateThumbStoragePath: vi.fn(),
      generateThumbnail: vi.fn(),
      removeObject: vi.fn(),
    };

    await reconcileIntakePhotos(deps, { repairThumbnails: false });
    expect(deps.downloadObject).not.toHaveBeenCalled();
    expect(deps.uploadObject).not.toHaveBeenCalled();
    expect(deps.updateThumbStoragePath).not.toHaveBeenCalled();
    expect(deps.removeObject).not.toHaveBeenCalled();
  });
});

describe("reconcileIntakePhotos --repair-thumbnails", () => {
  it("reuses an existing deterministic thumb before generating", async () => {
    const storagePath = `${WO_A}/front/${PHOTO_A}.jpg`;
    const thumbPath = intakeThumbStoragePath(storagePath);
    const downloadObject = vi.fn();
    const uploadObject = vi.fn();
    const generateThumbnail = vi.fn();
    const updateThumbStoragePath = vi.fn();

    const report = await reconcileIntakePhotos(
      {
        listPhotoPage: async () => [row(PHOTO_A, WO_A, "front", null)],
        listStoragePage: async (prefix) => {
          if (prefix === "") return [folder(WO_A)];
          if (prefix === WO_A) return [folder("front")];
          if (prefix === `${WO_A}/front`) {
            return [file(`${PHOTO_A}.jpg`), file(`${PHOTO_A}.thumb.jpg`)];
          }
          return [];
        },
        downloadObject,
        uploadObject,
        generateThumbnail,
        updateThumbStoragePath,
        removeObject: vi.fn(),
      },
      { repairThumbnails: true }
    );

    expect(downloadObject).not.toHaveBeenCalled();
    expect(generateThumbnail).not.toHaveBeenCalled();
    expect(uploadObject).not.toHaveBeenCalled();
    expect(updateThumbStoragePath).toHaveBeenCalledWith(PHOTO_A, thumbPath);
    expect(report.counts.repaired).toBe(1);
    expect(report.counts.failed).toBe(0);
  });

  it("generates from the original, uploads with upsert false, and updates the pointer only after upload", async () => {
    const storagePath = `${WO_A}/rear/${PHOTO_B}.jpg`;
    const thumbPath = intakeThumbStoragePath(storagePath);
    const order: string[] = [];
    const downloadObject = vi.fn(async () => {
      order.push("download");
      return new Uint8Array([1, 2, 3]);
    });
    const generateThumbnail = vi.fn(async () => {
      order.push("generate");
      return new Uint8Array([9, 9]);
    });
    const uploadObject = vi.fn(async (input) => {
      order.push("upload");
      expect(input).toEqual({
        path: thumbPath,
        bytes: new Uint8Array([9, 9]),
        contentType: "image/jpeg",
        upsert: false,
      });
    });
    const updateThumbStoragePath = vi.fn(async () => {
      order.push("update");
    });

    const report = await reconcileIntakePhotos(
      {
        listPhotoPage: async () => [
          {
            photo_id: PHOTO_B,
            storage_path: storagePath,
            thumb_storage_path: `${WO_A}/rear/${PHOTO_B}.thumb.jpg`,
          },
        ],
        listStoragePage: async (prefix) => {
          if (prefix === "") return [folder(WO_A)];
          if (prefix === WO_A) return [folder("rear")];
          if (prefix === `${WO_A}/rear`) return [file(`${PHOTO_B}.jpg`)];
          return [];
        },
        downloadObject,
        generateThumbnail,
        uploadObject,
        updateThumbStoragePath,
        removeObject: vi.fn(),
      },
      { repairThumbnails: true }
    );

    expect(order).toEqual(["download", "generate", "upload", "update"]);
    expect(report.counts.repaired).toBe(1);
  });

  it("reports a missing original and per-item failures without stopping or deleting", async () => {
    const missingOriginal = row(PHOTO_A, WO_A, "front", null);
    const failGenerate = row(PHOTO_B, WO_A, "rear", `${WO_A}/rear/${PHOTO_B}.thumb.jpg`);
    const ok = row(PHOTO_C, WO_B, "vin", null);
    const removeObject = vi.fn();
    const updateThumbStoragePath = vi.fn();

    const report = await reconcileIntakePhotos(
      {
        listPhotoPage: async () => [missingOriginal, failGenerate, ok],
        listStoragePage: async (prefix) => {
          if (prefix === "") return [folder(WO_A), folder(WO_B)];
          if (prefix === WO_A) return [folder("front"), folder("rear")];
          if (prefix === WO_B) return [folder("vin")];
          if (prefix === `${WO_A}/rear`) return [file(`${PHOTO_B}.jpg`)];
          if (prefix === `${WO_B}/vin`) {
            return [file(`${PHOTO_C}.jpg`), file(`${PHOTO_C}.thumb.jpg`)];
          }
          return [];
        },
        downloadObject: vi.fn(async () => new Uint8Array([1])),
        generateThumbnail: vi.fn(async () => {
          throw new Error("sharp failed");
        }),
        uploadObject: vi.fn(),
        updateThumbStoragePath,
        removeObject,
      },
      { repairThumbnails: true }
    );

    expect(report.missingOriginals.map((item) => item.photoId)).toEqual([PHOTO_A]);
    expect(report.counts.failed).toBe(1);
    expect(report.failures.some((item) => item.photoId === PHOTO_B)).toBe(true);
    expect(updateThumbStoragePath).toHaveBeenCalledWith(
      PHOTO_C,
      intakeThumbStoragePath(ok.storage_path)
    );
    expect(report.counts.repaired).toBe(1);
    expect(removeObject).not.toHaveBeenCalled();
  });

  it("never exceeds two concurrent download/generate/upload repairs", async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    const rows = [PHOTO_A, PHOTO_B, PHOTO_C, PHOTO_D].map((id, index) =>
      row(id, WO_A, `cat-${index}`, `${WO_A}/cat-${index}/${id}.thumb.jpg`)
    );

    const report = await reconcileIntakePhotos(
      {
        listPhotoPage: async () => rows,
        listStoragePage: async (prefix) => {
          if (prefix === "") return [folder(WO_A)];
          if (prefix === WO_A) {
            return rows.map((item) => folder(item.storage_path.split("/")[1]));
          }
          const category = prefix.split("/")[1];
          const match = rows.find((item) => item.storage_path.includes(`/${category}/`));
          return match ? [file(match.storage_path.split("/")[2])] : [];
        },
        downloadObject: vi.fn(async () => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 25));
          inFlight -= 1;
          return new Uint8Array([1]);
        }),
        generateThumbnail: vi.fn(async () => new Uint8Array([2])),
        uploadObject: vi.fn(async () => undefined),
        updateThumbStoragePath: vi.fn(async () => undefined),
        removeObject: vi.fn(),
      },
      { repairThumbnails: true, concurrency: 2 }
    );

    expect(report.counts.repaired).toBe(4);
    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(maxInFlight).toBe(2);
  });
});
