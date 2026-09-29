import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import {
  DIAGNOSTICS_MAX_IMAGE_PURPOSE_CHARS,
  DIAGNOSTICS_MAX_IMAGE_BYTES,
  prepareDiagnosticsImages,
  redactAndBoundDiagnosticsPhotoPurpose,
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
    thumbStoragePath: null,
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
    expect(deps.download).toHaveBeenCalledWith("wo-1/inspection_item/photo-1.jpg", {
      maxBytes: 10 * 1024 * 1024,
    });
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
        limitation: null,
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
      download: vi
        .fn()
        .mockResolvedValue(Buffer.from("00000018667479706865696300000000", "hex")),
      inspectImage: vi.fn().mockResolvedValue({
        format: "heif",
        width: 100,
        height: 100,
      }),
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

  it("requires an exact selected job for job work/proof photos", async () => {
    const deps = dependencies([row({ category: "job_proof", jobId: "job-1" })]);

    await expect(
      prepareDiagnosticsImages(
        {
          workOrderId: "wo-1",
          selections: [{ photoId: "photo-1", purpose: "Inspect completed work" }],
        },
        deps
      )
    ).rejects.toThrow("DIAGNOSTICS_IMAGE_JOB_REQUIRED");
    expect(deps.download).not.toHaveBeenCalled();
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

    await expect(
      prepareDiagnosticsImages(
        {
          workOrderId: "wo-1",
          jobId: "job-1",
          selections: [{ photoId: "photo-1", purpose: "Wrong inspection job" }],
        },
        dependencies([row({ category: "inspection_item", jobId: "job-2" })])
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
    ).rejects.toThrow("DIAGNOSTICS_IMAGE_FORMAT_UNSUPPORTED");
  });

  it.each([
    ["svg", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>")],
    ["pdf", Buffer.from("%PDF-1.7 private")],
    ["tiff", Buffer.from("49492a0008000000", "hex")],
  ])("rejects unsupported %s magic before decode", async (_format, bytes) => {
    const deps = dependencies([row()]);
    deps.download.mockResolvedValue(bytes);

    await expect(
      prepareDiagnosticsImages(
        {
          workOrderId: "wo-1",
          selections: [{ photoId: "photo-1", purpose: "Inspect" }],
        },
        deps
      )
    ).rejects.toThrow("DIAGNOSTICS_IMAGE_FORMAT_UNSUPPORTED");
  });

  it("enforces the 50M input-pixel limit before normalization", async () => {
    const deps = {
      ...dependencies([row()]),
      inspectImage: vi.fn().mockResolvedValue({
        format: "jpeg",
        width: 10_000,
        height: 5_001,
      }),
      normalizeImage: vi.fn(),
    };

    await expect(
      prepareDiagnosticsImages(
        {
          workOrderId: "wo-1",
          selections: [{ photoId: "photo-1", purpose: "Inspect" }],
        },
        deps
      )
    ).rejects.toThrow("DIAGNOSTICS_IMAGE_PIXEL_LIMIT");
    expect(deps.normalizeImage).not.toHaveBeenCalled();
  });

  it("passes the aligned 10MB cap into every storage download", async () => {
    const deps = dependencies([row()]);
    await prepareDiagnosticsImages(
      {
        workOrderId: "wo-1",
        selections: [{ photoId: "photo-1", purpose: "Inspect" }],
      },
      deps
    );
    expect(deps.download).toHaveBeenCalledWith(expect.any(String), {
      maxBytes: 10 * 1024 * 1024,
    });
  });

  it("falls back from unsupported stored HEIF decode to its JPEG thumbnail", async () => {
    const original = Buffer.from("00000018667479706865696300000000", "hex");
    const thumbnail = await jpeg();
    const normalized = await jpeg();
    const deps = {
      loadRows: vi.fn().mockResolvedValue([
        row({
          storagePath: "wo-1/inspection_item/photo-1.heic",
          thumbStoragePath: "wo-1/inspection_item/photo-1.thumb.jpg",
        }),
      ]),
      download: vi.fn().mockResolvedValueOnce(original).mockResolvedValueOnce(thumbnail),
      inspectImage: vi
        .fn()
        .mockResolvedValueOnce({ format: "heif", width: 3_000, height: 2_000 })
        .mockResolvedValueOnce({ format: "jpeg", width: 480, height: 320 }),
      normalizeImage: vi
        .fn()
        .mockRejectedValueOnce(new Error("decoder unavailable"))
        .mockResolvedValueOnce(normalized),
    };

    const result = await prepareDiagnosticsImages(
      {
        workOrderId: "wo-1",
        selections: [{ photoId: "photo-1", purpose: "Inspect" }],
      },
      deps
    );

    expect(deps.download).toHaveBeenNthCalledWith(
      2,
      "wo-1/inspection_item/photo-1.thumb.jpg",
      { maxBytes: 10 * 1024 * 1024 }
    );
    expect(result.photoMetadata[0]?.limitation).toMatch(/lower-resolution/i);
    expect(result.images[0]?.limitation).toMatch(/lower-resolution/i);
  });

  it("uses the JPEG thumbnail when HEIF metadata cannot be decoded", async () => {
    const original = Buffer.from("00000018667479706865696300000000", "hex");
    const thumbnail = await jpeg();
    const deps = {
      loadRows: vi.fn().mockResolvedValue([
        row({
          storagePath: "wo-1/inspection_item/photo-1.heif",
          thumbStoragePath: "wo-1/inspection_item/photo-1.thumb.jpg",
        }),
      ]),
      download: vi.fn().mockResolvedValueOnce(original).mockResolvedValueOnce(thumbnail),
      inspectImage: vi
        .fn()
        .mockRejectedValueOnce(new Error("HEIF decoder unavailable"))
        .mockResolvedValueOnce({ format: "jpeg", width: 480, height: 320 }),
      normalizeImage: vi.fn().mockResolvedValue(thumbnail),
    };

    const result = await prepareDiagnosticsImages(
      {
        workOrderId: "wo-1",
        selections: [{ photoId: "photo-1", purpose: "Inspect" }],
      },
      deps
    );

    expect(result.photoMetadata[0]?.limitation).toMatch(/lower-resolution/i);
    expect(deps.normalizeImage).toHaveBeenCalledTimes(1);
  });

  it("maps invalid injected normalization output to a safe code", async () => {
    const deps = {
      ...dependencies([row()]),
      normalizeImage: vi.fn().mockResolvedValue(Buffer.from("not-jpeg")),
    };
    await expect(
      prepareDiagnosticsImages(
        {
          workOrderId: "wo-1",
          selections: [{ photoId: "photo-1", purpose: "Inspect" }],
        },
        deps
      )
    ).rejects.toThrow("DIAGNOSTICS_IMAGE_NORMALIZATION_FAILED");
  });

  it("preserves image-purpose context while redacting PII and URLs", async () => {
    const deps = dependencies([row()]);
    const result = await prepareDiagnosticsImages(
      {
        workOrderId: "wo-1",
        selections: [
          {
            photoId: "photo-1",
            purpose:
              "Before https://private.test/a.jpg after for rider@test.ca at 647-424-1088",
          },
        ],
      },
      deps
    );

    expect(result.photoMetadata[0]?.purpose).toBe(
      "Before [REDACTED_URL] after for [REDACTED_EMAIL] at [REDACTED_PHONE]"
    );
  });

  it("redacts and bounds an adversarial near-limit customer purpose idempotently", async () => {
    const rawPurpose = "Minh Tran ".repeat(50).trim();
    expect(rawPurpose).toHaveLength(DIAGNOSTICS_MAX_IMAGE_PURPOSE_CHARS - 1);
    const redactTerms = { customerName: "Minh Tran" };
    const firstProviderCopy = redactAndBoundDiagnosticsPhotoPurpose(
      rawPurpose,
      redactTerms
    );

    const result = await prepareDiagnosticsImages(
      {
        workOrderId: "wo-1",
        selections: [{ photoId: "photo-1", purpose: firstProviderCopy }],
        redactTerms,
      },
      dependencies([row()])
    );

    const providerPurpose = result.images[0]!.purpose;
    expect(providerPurpose.length).toBeLessThanOrEqual(
      DIAGNOSTICS_MAX_IMAGE_PURPOSE_CHARS
    );
    expect(providerPurpose).not.toMatch(/Minh|Tran/i);
    expect(providerPurpose).toContain(
      "[CLIPPED AFTER REDACTION TO PROVIDER PHOTO PURPOSE LIMIT]"
    );
    expect(providerPurpose).toBe(firstProviderCopy);
    expect(result.photoMetadata[0]!.purpose).toBe(providerPurpose);
  });

  it("uses a separate normalized-size failure code", async () => {
    const deps = {
      ...dependencies([row()]),
      normalizeImage: vi.fn().mockResolvedValue(Buffer.alloc(5 * 1024 * 1024 + 1, 1)),
    };
    await expect(
      prepareDiagnosticsImages(
        {
          workOrderId: "wo-1",
          selections: [{ photoId: "photo-1", purpose: "Inspect" }],
        },
        deps
      )
    ).rejects.toThrow("DIAGNOSTICS_IMAGE_NORMALIZED_TOO_LARGE");
  });
});
