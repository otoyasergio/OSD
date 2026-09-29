import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import {
  DIAGNOSTICS_MAX_IMAGE_BYTES,
  prepareDiagnosticsImages,
  type DiagnosticsPhotoRow,
} from "@/lib/diagnostics/images";

const jpeg = () =>
  sharp({
    create: {
      width: 4,
      height: 2,
      channels: 3,
      background: "#cc0000",
    },
  })
    .jpeg()
    .toBuffer();

function row(overrides: Partial<DiagnosticsPhotoRow> = {}): DiagnosticsPhotoRow {
  return {
    photoId: "photo-1",
    workOrderId: "wo-1",
    jobId: null,
    category: "inspection_item",
    storagePath: "wo-1/inspection_item/photo-1.jpg",
    ...overrides,
  };
}

function dependencies(rows: DiagnosticsPhotoRow[]) {
  return {
    loadRows: vi.fn().mockResolvedValue(rows),
    download: vi.fn().mockResolvedValue(jpeg()),
  };
}

describe("diagnostics selected image preparation", () => {
  it("loads only selected IDs and emits normalized Base64 JPEG plus persistence metadata", async () => {
    const deps = dependencies([row()]);

    const result = await prepareDiagnosticsImages(
      {
        workOrderId: "wo-1",
        selections: [{ photoId: "photo-1", purpose: "Inspect terminal damage" }],
      },
      deps
    );

    expect(deps.loadRows).toHaveBeenCalledWith(["photo-1"]);
    expect(deps.download).toHaveBeenCalledWith("wo-1/inspection_item/photo-1.jpg");
    expect(result.images).toEqual([
      expect.objectContaining({
        dataUrl: expect.stringMatching(/^data:image\/jpeg;base64,/),
        detail: "high",
      }),
    ]);
    expect(result.photoMetadata).toEqual([
      {
        photoId: "photo-1",
        purpose: "Inspect terminal damage",
        sortOrder: 0,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("storagePath");
    expect(JSON.stringify(result)).not.toContain("https://");

    const normalized = Buffer.from(
      result.images[0]!.dataUrl.replace("data:image/jpeg;base64,", ""),
      "base64"
    );
    expect(normalized.byteLength).toBeLessThanOrEqual(DIAGNOSTICS_MAX_IMAGE_BYTES);
    expect(await sharp(normalized).metadata()).toMatchObject({
      format: "jpeg",
      width: 4,
      height: 2,
    });
  });

  it("normalizes HEIC-like input through an injected decoder", async () => {
    const normalizeImage = vi.fn().mockResolvedValue(await jpeg());
    const deps = {
      loadRows: vi.fn().mockResolvedValue([
        row({
          storagePath: "wo-1/inspection_item/photo-1.heic",
        }),
      ]),
      download: vi.fn().mockResolvedValue(Buffer.from("fake-heic")),
      normalizeImage,
    };

    const result = await prepareDiagnosticsImages(
      {
        workOrderId: "wo-1",
        selections: [{ photoId: "photo-1", purpose: "Inspect component" }],
      },
      deps
    );

    expect(normalizeImage).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.objectContaining({ maxEdge: 2048 })
    );
    expect(result.images[0]!.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("allows a same-work-order job photo in work-order-wide context", async () => {
    const deps = dependencies([row({ category: "job_proof", jobId: "job-1" })]);

    const result = await prepareDiagnosticsImages(
      {
        workOrderId: "wo-1",
        selections: [{ photoId: "photo-1", purpose: "Inspect completed work" }],
      },
      deps
    );

    expect(result.photoMetadata[0]).toMatchObject({ photoId: "photo-1" });
  });

  it.each([
    "vin",
    "odometer",
    "front",
    "rear",
    "left_side",
    "right_side",
    "damage",
    "accessories",
    "fuel_level",
    "other",
    "signature",
    "customer_document",
  ])("rejects disallowed category %s", async (category) => {
    const deps = dependencies([row({ category })]);

    await expect(
      prepareDiagnosticsImages(
        {
          workOrderId: "wo-1",
          selections: [{ photoId: "photo-1", purpose: "Use photo" }],
        },
        deps
      )
    ).rejects.toThrow("DIAGNOSTICS_IMAGE_CATEGORY_NOT_ALLOWED");
    expect(deps.download).not.toHaveBeenCalled();
  });

  it("rejects missing, duplicate, cross-WO, and incompatible job rows", async () => {
    await expect(
      prepareDiagnosticsImages(
        {
          workOrderId: "wo-1",
          selections: [{ photoId: "photo-1", purpose: "Missing" }],
        },
        dependencies([])
      )
    ).rejects.toThrow("DIAGNOSTICS_IMAGE_NOT_FOUND");

    await expect(
      prepareDiagnosticsImages(
        {
          workOrderId: "wo-1",
          selections: [
            { photoId: "photo-1", purpose: "One" },
            { photoId: "photo-1", purpose: "Two" },
          ],
        },
        dependencies([row()])
      )
    ).rejects.toThrow("DIAGNOSTICS_IMAGE_DUPLICATE");

    await expect(
      prepareDiagnosticsImages(
        {
          workOrderId: "wo-1",
          selections: [{ photoId: "photo-1", purpose: "Wrong WO" }],
        },
        dependencies([row({ workOrderId: "wo-2" })])
      )
    ).rejects.toThrow("DIAGNOSTICS_IMAGE_WORK_ORDER_MISMATCH");

    await expect(
      prepareDiagnosticsImages(
        {
          workOrderId: "wo-1",
          jobId: "job-1",
          selections: [{ photoId: "photo-1", purpose: "Wrong job" }],
        },
        dependencies([row({ category: "job_work", jobId: "job-2" })])
      )
    ).rejects.toThrow("DIAGNOSTICS_IMAGE_JOB_MISMATCH");
  });

  it("caps selection and downloaded/normalized bytes, failing closed", async () => {
    await expect(
      prepareDiagnosticsImages(
        {
          workOrderId: "wo-1",
          selections: Array.from({ length: 4 }, (_, index) => ({
            photoId: `photo-${index}`,
            purpose: "Inspect",
          })),
        },
        dependencies([])
      )
    ).rejects.toThrow("DIAGNOSTICS_IMAGE_SELECTION_LIMIT");

    const tooLarge = dependencies([row()]);
    tooLarge.download.mockResolvedValue(Buffer.alloc(DIAGNOSTICS_MAX_IMAGE_BYTES + 1));
    await expect(
      prepareDiagnosticsImages(
        {
          workOrderId: "wo-1",
          selections: [{ photoId: "photo-1", purpose: "Large" }],
        },
        tooLarge
      )
    ).rejects.toThrow("DIAGNOSTICS_IMAGE_TOO_LARGE");

    const invalid = dependencies([row()]);
    invalid.download.mockResolvedValue(Buffer.from("not-an-image"));
    await expect(
      prepareDiagnosticsImages(
        {
          workOrderId: "wo-1",
          selections: [{ photoId: "photo-1", purpose: "Invalid" }],
        },
        invalid
      )
    ).rejects.toThrow("DIAGNOSTICS_IMAGE_DECODE_FAILED");
  });
});
