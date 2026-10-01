import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  orchestrateIntakePhotoUpload,
  type IntakePhotoInsert,
  type IntakePhotoStorageUpload,
  type IntakePhotoUploadDependencies,
  type IntakePhotoUploadInput,
  type IntakePhotoUploadRow,
} from "@/lib/photos/intakePhotoUploadOrchestrator";

const WORK_ORDER_ID = "41111111-1111-4111-8111-111111111111";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const PHOTO_ID = "71111111-1111-4111-8111-111111111111";
const LOSER_PHOTO_ID = "73333333-3333-4333-8333-333333333333";
const CLIENT_UPLOAD_ID = "81111111-1111-4111-8111-111111111111";

function input(overrides: Partial<IntakePhotoUploadInput> = {}): IntakePhotoUploadInput {
  return {
    workOrderId: WORK_ORDER_ID,
    uploadedByUserId: USER_ID,
    clientUploadId: CLIENT_UPLOAD_ID,
    category: "front",
    notes: null,
    inspectionResultId: null,
    jobId: null,
    sourceBytes: new Uint8Array([1, 2, 3]),
    ...overrides,
  };
}

function rowFromInsert(insert: IntakePhotoInsert): IntakePhotoUploadRow {
  return {
    ...insert,
    photo_url: null,
    created_at: "2026-10-01T00:00:00.000Z",
  };
}

function harness() {
  const findPhotoByClientUploadId = vi.fn(
    async (_clientUploadId: string): Promise<IntakePhotoUploadRow | null> => null
  );
  const prepareCanonicalPhoto = vi.fn(async () => ({
    bytes: Buffer.from([10, 11, 12, 13]),
    width: 1200,
    height: 900,
    contentType: "image/jpeg" as const,
    byteSize: 4,
  }));
  const makeThumbnail = vi.fn(async () => Buffer.from([20, 21]));
  const uploadObject = vi.fn(
    async (_upload: IntakePhotoStorageUpload): Promise<void> => undefined
  );
  const removeObjects = vi.fn(async () => undefined);
  const insertPhoto = vi.fn(async (insert: IntakePhotoInsert) => rowFromInsert(insert));
  const logThumbnailFailure = vi.fn();
  const logCleanupFailure = vi.fn();

  const dependencies: IntakePhotoUploadDependencies = {
    createPhotoId: () => PHOTO_ID,
    findPhotoByClientUploadId,
    prepareCanonicalPhoto,
    makeThumbnail,
    uploadObject,
    removeObjects,
    insertPhoto,
    logThumbnailFailure,
    logCleanupFailure,
  };

  return {
    dependencies,
    findPhotoByClientUploadId,
    prepareCanonicalPhoto,
    makeThumbnail,
    uploadObject,
    removeObjects,
    insertPhoto,
    logThumbnailFailure,
    logCleanupFailure,
  };
}

describe("orchestrateIntakePhotoUpload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores one canonical JPEG, row, thumbnail, timeline event, and audit entry", async () => {
    const h = harness();

    const result = await orchestrateIntakePhotoUpload(input(), h.dependencies);

    const fullPath = `${WORK_ORDER_ID}/front/${PHOTO_ID}.jpg`;
    const thumbPath = `${WORK_ORDER_ID}/front/${PHOTO_ID}.thumb.jpg`;
    expect(h.uploadObject).toHaveBeenNthCalledWith(1, {
      path: fullPath,
      bytes: Buffer.from([10, 11, 12, 13]),
      contentType: "image/jpeg",
      upsert: false,
    });
    expect(h.uploadObject).toHaveBeenNthCalledWith(2, {
      path: thumbPath,
      bytes: Buffer.from([20, 21]),
      contentType: "image/jpeg",
      upsert: false,
    });
    expect(h.insertPhoto).toHaveBeenCalledTimes(1);
    expect(h.insertPhoto).toHaveBeenCalledWith(
      expect.objectContaining({
        photo_id: PHOTO_ID,
        client_upload_id: CLIENT_UPLOAD_ID,
        storage_path: fullPath,
        thumb_storage_path: thumbPath,
        content_type: "image/jpeg",
        byte_size: 4,
        pixel_width: 1200,
        pixel_height: 900,
      })
    );
    expect(result.photo_id).toBe(PHOTO_ID);
  });

  it("returns a lost-response replay without any new writes", async () => {
    const h = harness();
    const existing = rowFromInsert({
      photo_id: "72222222-2222-4222-8222-222222222222",
      work_order_id: WORK_ORDER_ID,
      uploaded_by_user_id: USER_ID,
      storage_path: `${WORK_ORDER_ID}/front/existing.jpg`,
      thumb_storage_path: `${WORK_ORDER_ID}/front/existing.thumb.jpg`,
      photo_url: null,
      category: "front",
      notes: null,
      inspection_result_id: null,
      job_id: null,
      client_upload_id: CLIENT_UPLOAD_ID,
      content_type: "image/jpeg",
      byte_size: 1234,
      pixel_width: 1000,
      pixel_height: 750,
    });
    h.findPhotoByClientUploadId.mockResolvedValue(existing);

    const result = await orchestrateIntakePhotoUpload(input(), h.dependencies);

    expect(result).toBe(existing);
    expect(h.prepareCanonicalPhoto).not.toHaveBeenCalled();
    expect(h.uploadObject).not.toHaveBeenCalled();
    expect(h.insertPhoto).not.toHaveBeenCalled();
  });

  it.each([
    ["work order", { work_order_id: "42222222-2222-4222-8222-222222222222" }],
    ["category", { category: "rear" }],
    ["job", { job_id: "51111111-1111-4111-8111-111111111111" }],
    ["inspection", { inspection_result_id: "61111111-1111-4111-8111-111111111111" }],
  ] as const)(
    "rejects a reused ID with conflicting %s linkage",
    async (_name, change) => {
      const h = harness();
      const existing = rowFromInsert({
        photo_id: "72222222-2222-4222-8222-222222222222",
        work_order_id: WORK_ORDER_ID,
        uploaded_by_user_id: USER_ID,
        storage_path: `${WORK_ORDER_ID}/front/existing.jpg`,
        thumb_storage_path: null,
        photo_url: null,
        category: "front",
        notes: null,
        inspection_result_id: null,
        job_id: null,
        client_upload_id: CLIENT_UPLOAD_ID,
        content_type: "image/jpeg",
        byte_size: 1234,
        pixel_width: 1000,
        pixel_height: 750,
        ...change,
      });
      h.findPhotoByClientUploadId.mockResolvedValue(existing);

      await expect(orchestrateIntakePhotoUpload(input(), h.dependencies)).rejects.toThrow(
        "PHOTO_UPLOAD_ID_CONFLICT"
      );
      expect(h.uploadObject).not.toHaveBeenCalled();
      expect(h.insertPhoto).not.toHaveBeenCalled();
    }
  );

  it("lets the unique index resolve concurrent deliveries and removes loser objects", async () => {
    const h = harness();
    let winner: IntakePhotoUploadRow | null = null;
    h.findPhotoByClientUploadId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockImplementation(async () => winner);
    h.dependencies.createPhotoId = vi
      .fn()
      .mockReturnValueOnce(PHOTO_ID)
      .mockReturnValueOnce(LOSER_PHOTO_ID);
    h.insertPhoto.mockImplementation(async (insert: IntakePhotoInsert) => {
      if (!winner) {
        winner = rowFromInsert(insert);
        return winner;
      }
      throw { code: "23505", message: "duplicate key" };
    });

    const [first, second] = await Promise.all([
      orchestrateIntakePhotoUpload(input(), h.dependencies),
      orchestrateIntakePhotoUpload(input(), h.dependencies),
    ]);

    expect(first.photo_id).toBe(PHOTO_ID);
    expect(second.photo_id).toBe(PHOTO_ID);
    expect(h.insertPhoto).toHaveBeenCalledTimes(2);
    expect(h.removeObjects).toHaveBeenCalledWith([
      `${WORK_ORDER_ID}/front/${LOSER_PHOTO_ID}.jpg`,
      `${WORK_ORDER_ID}/front/${LOSER_PHOTO_ID}.thumb.jpg`,
    ]);
  });

  it("cleans a race loser's objects before surfacing a safe winner lookup error", async () => {
    const h = harness();
    h.findPhotoByClientUploadId
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("database connection details"));
    h.insertPhoto.mockRejectedValue({ code: "23505", message: "duplicate key" });

    await expect(orchestrateIntakePhotoUpload(input(), h.dependencies)).rejects.toThrow(
      "PHOTO_UPLOAD_FAILED"
    );
    expect(h.removeObjects).toHaveBeenCalledWith([
      `${WORK_ORDER_ID}/front/${PHOTO_ID}.jpg`,
      `${WORK_ORDER_ID}/front/${PHOTO_ID}.thumb.jpg`,
    ]);
  });

  it("removes the canonical original and thumbnail after an ordinary insert failure", async () => {
    const h = harness();
    h.insertPhoto.mockRejectedValue(new Error("insert failed"));

    await expect(
      orchestrateIntakePhotoUpload(input({ clientUploadId: null }), h.dependencies)
    ).rejects.toThrow("insert failed");
    expect(h.removeObjects).toHaveBeenCalledWith([
      `${WORK_ORDER_ID}/front/${PHOTO_ID}.jpg`,
      `${WORK_ORDER_ID}/front/${PHOTO_ID}.thumb.jpg`,
    ]);
    expect(h.insertPhoto).toHaveBeenCalledTimes(1);
  });

  it("preserves the canonical row with no thumbnail after thumbnail upload failure", async () => {
    const h = harness();
    h.uploadObject.mockImplementation(async ({ path }) => {
      if (path.endsWith(".thumb.jpg")) {
        throw {
          statusCode: 503,
          message: "https://signed.example/private-thumb.jpg",
        };
      }
    });

    const result = await orchestrateIntakePhotoUpload(input(), h.dependencies);

    expect(result.storage_path).toBe(`${WORK_ORDER_ID}/front/${PHOTO_ID}.jpg`);
    expect(result.thumb_storage_path).toBeNull();
    expect(h.insertPhoto).toHaveBeenCalledWith(
      expect.objectContaining({ thumb_storage_path: null })
    );
    expect(h.insertPhoto).toHaveBeenCalledTimes(1);
    expect(h.removeObjects).not.toHaveBeenCalled();
    expect(h.logThumbnailFailure).toHaveBeenCalledWith({
      workOrderId: WORK_ORDER_ID,
      photoId: PHOTO_ID,
      stage: "upload",
      statusCode: "503",
    });
    expect(JSON.stringify(h.logThumbnailFailure.mock.calls)).not.toContain(
      "signed.example"
    );
  });

  it("preserves the candidate when a lost RPC response already committed this photo", async () => {
    const h = harness();
    const committedPath = `${WORK_ORDER_ID}/front/${PHOTO_ID}.jpg`;
    const committed = rowFromInsert({
      photo_id: PHOTO_ID,
      work_order_id: WORK_ORDER_ID,
      uploaded_by_user_id: USER_ID,
      storage_path: committedPath,
      thumb_storage_path: `${WORK_ORDER_ID}/front/${PHOTO_ID}.thumb.jpg`,
      photo_url: null,
      category: "front",
      notes: null,
      inspection_result_id: null,
      job_id: null,
      client_upload_id: CLIENT_UPLOAD_ID,
      content_type: "image/jpeg",
      byte_size: 4,
      pixel_width: 1200,
      pixel_height: 900,
    });
    h.findPhotoByClientUploadId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(committed);
    h.insertPhoto.mockRejectedValue(new Error("fetch failed after commit"));

    const result = await orchestrateIntakePhotoUpload(input(), h.dependencies);

    expect(result).toEqual(committed);
    expect(h.removeObjects).not.toHaveBeenCalled();
  });

  it("cleans loser objects then returns the concurrent winner after any RPC error", async () => {
    const h = harness();
    const winner = rowFromInsert({
      photo_id: "72222222-2222-4222-8222-222222222222",
      work_order_id: WORK_ORDER_ID,
      uploaded_by_user_id: USER_ID,
      storage_path: `${WORK_ORDER_ID}/front/winner.jpg`,
      thumb_storage_path: `${WORK_ORDER_ID}/front/winner.thumb.jpg`,
      photo_url: null,
      category: "front",
      notes: null,
      inspection_result_id: null,
      job_id: null,
      client_upload_id: CLIENT_UPLOAD_ID,
      content_type: "image/jpeg",
      byte_size: 4,
      pixel_width: 1200,
      pixel_height: 900,
    });
    h.findPhotoByClientUploadId.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
    h.insertPhoto.mockRejectedValue({ message: "statement timeout" });

    const result = await orchestrateIntakePhotoUpload(input(), h.dependencies);

    expect(result).toEqual(winner);
    expect(h.removeObjects).toHaveBeenCalledWith([
      `${WORK_ORDER_ID}/front/${PHOTO_ID}.jpg`,
      `${WORK_ORDER_ID}/front/${PHOTO_ID}.thumb.jpg`,
    ]);
  });

  it("cleans the candidate and surfaces a safe error when the RPC fails with no row", async () => {
    const h = harness();
    h.insertPhoto.mockRejectedValue({ message: "connection reset" });

    await expect(orchestrateIntakePhotoUpload(input(), h.dependencies)).rejects.toThrow(
      "PHOTO_UPLOAD_FAILED"
    );
    expect(h.findPhotoByClientUploadId).toHaveBeenCalledTimes(2);
    expect(h.removeObjects).toHaveBeenCalledWith([
      `${WORK_ORDER_ID}/front/${PHOTO_ID}.jpg`,
      `${WORK_ORDER_ID}/front/${PHOTO_ID}.thumb.jpg`,
    ]);
  });

  it("does not remove candidate objects when reconciliation lookup throws after an ambiguous RPC error", async () => {
    const h = harness();
    h.findPhotoByClientUploadId
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("statement timeout"));
    h.insertPhoto.mockRejectedValue({ message: "connection reset" });

    await expect(orchestrateIntakePhotoUpload(input(), h.dependencies)).rejects.toThrow(
      "PHOTO_UPLOAD_FAILED"
    );
    expect(h.findPhotoByClientUploadId).toHaveBeenCalledTimes(2);
    expect(h.removeObjects).not.toHaveBeenCalled();
  });

  it("returns a confirmed winner when loser cleanup fails so the technician does not retry forever", async () => {
    const h = harness();
    const winner = rowFromInsert({
      photo_id: "72222222-2222-4222-8222-222222222222",
      work_order_id: WORK_ORDER_ID,
      uploaded_by_user_id: USER_ID,
      storage_path: `${WORK_ORDER_ID}/front/winner.jpg`,
      thumb_storage_path: null,
      photo_url: null,
      category: "front",
      notes: null,
      inspection_result_id: null,
      job_id: null,
      client_upload_id: CLIENT_UPLOAD_ID,
      content_type: "image/jpeg",
      byte_size: 4,
      pixel_width: 1200,
      pixel_height: 900,
    });
    h.findPhotoByClientUploadId.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
    h.insertPhoto.mockRejectedValue({ code: "23505", message: "duplicate key" });
    h.removeObjects.mockRejectedValue(new Error("PHOTO_UPLOAD_FAILED"));

    const result = await orchestrateIntakePhotoUpload(input(), h.dependencies);

    expect(result).toEqual(winner);
    expect(h.removeObjects).toHaveBeenCalledWith([
      `${WORK_ORDER_ID}/front/${PHOTO_ID}.jpg`,
      `${WORK_ORDER_ID}/front/${PHOTO_ID}.thumb.jpg`,
    ]);
    expect(h.logCleanupFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "winner_cleanup",
        pathCount: 2,
      })
    );
    expect(JSON.stringify(h.logCleanupFailure.mock.calls)).not.toContain(
      "signed.example"
    );
  });

  it("attempts cleanup after an ordinary insert failure and still surfaces the insert error", async () => {
    const h = harness();
    h.insertPhoto.mockRejectedValue(new Error("insert failed"));
    h.removeObjects.mockRejectedValue(new Error("PHOTO_UPLOAD_FAILED"));

    await expect(
      orchestrateIntakePhotoUpload(input({ clientUploadId: null }), h.dependencies)
    ).rejects.toThrow("insert failed");
    expect(h.removeObjects).toHaveBeenCalledWith([
      `${WORK_ORDER_ID}/front/${PHOTO_ID}.jpg`,
      `${WORK_ORDER_ID}/front/${PHOTO_ID}.thumb.jpg`,
    ]);
  });
});
