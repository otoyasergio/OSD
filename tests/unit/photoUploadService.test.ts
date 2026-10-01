import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  addAuditLog,
  addTimelineEvent,
  createClient,
  requireUser,
  storageUpload,
  storageRemove,
  rpc,
  intakePhotoSelect,
  createPhotoAdminClient,
  adminStorageRemove,
} = vi.hoisted(() => ({
  addAuditLog: vi.fn(),
  addTimelineEvent: vi.fn(),
  createClient: vi.fn(),
  requireUser: vi.fn(),
  storageUpload: vi.fn(),
  storageRemove: vi.fn(),
  rpc: vi.fn(),
  intakePhotoSelect: vi.fn(),
  createPhotoAdminClient: vi.fn(),
  adminStorageRemove: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ requireUser }));
vi.mock("@/lib/database/supabase-server", () => ({ createClient }));
vi.mock("@/lib/audit/addAuditLog", () => ({ addAuditLog }));
vi.mock("@/lib/timeline/addTimelineEvent", () => ({ addTimelineEvent }));
vi.mock("@/lib/database/supabase-admin", () => ({ createPhotoAdminClient }));

import { uploadIntakePhoto } from "@/lib/services/photos";

const WORK_ORDER_ID = "41111111-1111-4111-8111-111111111111";
const LOCATION_ID = "31111111-1111-4111-8111-111111111111";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const WINNER_PHOTO_ID = "72222222-2222-4222-8222-222222222222";

function client(
  options: {
    workOrder?: Record<string, unknown>;
    jobs?: Array<Record<string, unknown>>;
  } = {}
) {
  const storage = {
    upload: storageUpload,
    remove: storageRemove,
    createSignedUrls: vi.fn(async (paths: string[]) => ({
      data: paths.map((path) => ({
        path,
        signedUrl: `https://signed.example/${path}`,
      })),
      error: null,
    })),
  };
  const from = vi.fn((table: string) => {
    if (table === "work_order") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                work_order_id: WORK_ORDER_ID,
                location_id: LOCATION_ID,
                work_order_number: "WO-100",
                status: "open",
                quality_checked_at: null,
                quality_checked_by_user_id: null,
                ...options.workOrder,
              },
              error: null,
            }),
          }),
        }),
      };
    }
    if (table === "intake_photo") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: intakePhotoSelect,
          }),
        }),
        insert: () => {
          throw new Error("direct intake_photo insert is not allowed");
        },
      };
    }
    if (table === "job") {
      const result = Promise.resolve({
        data: options.jobs ?? [],
        error: null,
      });
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({
          data: (options.jobs ?? [])[0] ?? null,
          error: null,
        }),
        then: result.then.bind(result),
      };
      return chain;
    }
    throw new Error(`Unexpected table ${table}`);
  });
  return {
    from,
    rpc,
    storage: {
      from: () => storage,
    },
  };
}

function adminClient() {
  return {
    from: () => ({
      select: () => ({
        in: async () => ({ data: [], error: null }),
      }),
    }),
    storage: {
      from: () => ({
        remove: adminStorageRemove,
      }),
    },
  };
}

describe("uploadIntakePhoto canonical validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({
      user_id: USER_ID,
      role: "owner",
      status: "active",
      active_location_id: LOCATION_ID,
      location_ids: [LOCATION_ID],
    });
    storageUpload.mockResolvedValue({ error: null });
    storageRemove.mockResolvedValue({ error: null });
    adminStorageRemove.mockResolvedValue({ error: null });
    intakePhotoSelect.mockResolvedValue({ data: null, error: null });
    rpc.mockResolvedValue({ data: [], error: null });
    createPhotoAdminClient.mockReturnValue(adminClient());
    createClient.mockResolvedValue(client());
  });

  it("fails invalid image bytes before any storage write", async () => {
    const file = new File([Buffer.from("not an image")], "fake.jpg", {
      type: "image/jpeg",
    });

    await expect(
      uploadIntakePhoto(WORK_ORDER_ID, {
        category: "front",
        file,
      })
    ).rejects.toThrow("PHOTO_TYPE_INVALID");
    expect(storageUpload).not.toHaveBeenCalled();
  });

  it("rejects a malformed client upload ID before any storage write", async () => {
    const jpeg = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: "#000000",
      },
    })
      .jpeg()
      .toBuffer();
    const input = {
      category: "front" as const,
      client_upload_id: "not-a-uuid",
      file: new File([jpeg], "valid.jpg", { type: "image/jpeg" }),
    };

    await expect(uploadIntakePhoto(WORK_ORDER_ID, input)).rejects.toThrow();
    expect(storageUpload).not.toHaveBeenCalled();
  });

  it("commits the photo through the atomic RPC and never writes event or audit separately", async () => {
    const jpeg = await sharp({
      create: {
        width: 4,
        height: 4,
        channels: 3,
        background: "#111111",
      },
    })
      .jpeg()
      .toBuffer();
    const clientUploadId = "81111111-1111-4111-8111-111111111111";
    rpc.mockImplementation(async (_name: string, args: Record<string, unknown>) => ({
      data: [
        {
          photo_id: args.p_photo_id,
          work_order_id: WORK_ORDER_ID,
          uploaded_by_user_id: USER_ID,
          storage_path: args.p_storage_path,
          thumb_storage_path: args.p_thumb_storage_path,
          photo_url: null,
          category: args.p_category,
          notes: args.p_notes,
          inspection_result_id: args.p_inspection_result_id,
          job_id: args.p_job_id,
          client_upload_id: args.p_client_upload_id,
          content_type: args.p_content_type,
          byte_size: args.p_byte_size,
          pixel_width: args.p_pixel_width,
          pixel_height: args.p_pixel_height,
          created_at: "2026-10-01T00:00:00.000Z",
        },
      ],
      error: null,
    }));

    const photo = await uploadIntakePhoto(WORK_ORDER_ID, {
      category: "front",
      client_upload_id: clientUploadId,
      file: new File([jpeg], "valid.jpg", { type: "image/jpeg" }),
    });

    expect(rpc).toHaveBeenCalledWith(
      "create_intake_photo_with_event",
      expect.objectContaining({
        p_work_order_id: WORK_ORDER_ID,
        p_category: "front",
        p_client_upload_id: clientUploadId,
        p_content_type: "image/jpeg",
      })
    );
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_actor_user_id");
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_location_id");
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_uploaded_by_user_id");
    expect(addTimelineEvent).not.toHaveBeenCalled();
    expect(addAuditLog).not.toHaveBeenCalled();
    expect(photo.client_upload_id).toBe(clientUploadId);
    expect(photo.signed_url).toMatch(/^https:\/\/signed\.example\//);
    expect(createPhotoAdminClient).not.toHaveBeenCalled();
    expect(storageRemove).not.toHaveBeenCalled();
  });
});

async function tinyJpeg() {
  return sharp({
    create: { width: 4, height: 4, channels: 3, background: "#111111" },
  })
    .jpeg()
    .toBuffer();
}

function commitRpc() {
  rpc.mockImplementation(async (_name: string, args: Record<string, unknown>) => ({
    data: [
      {
        photo_id: args.p_photo_id,
        work_order_id: WORK_ORDER_ID,
        uploaded_by_user_id: USER_ID,
        storage_path: args.p_storage_path,
        thumb_storage_path: args.p_thumb_storage_path,
        photo_url: null,
        category: args.p_category,
        notes: args.p_notes,
        inspection_result_id: args.p_inspection_result_id,
        job_id: args.p_job_id,
        client_upload_id: args.p_client_upload_id,
        content_type: args.p_content_type,
        byte_size: args.p_byte_size,
        pixel_width: args.p_pixel_width,
        pixel_height: args.p_pixel_height,
        created_at: "2026-10-01T00:00:00.000Z",
      },
    ],
    error: null,
  }));
}

describe("uploadIntakePhoto checkout timing and admin cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({
      user_id: USER_ID,
      role: "technician",
      status: "active",
      active_location_id: LOCATION_ID,
      location_ids: [LOCATION_ID],
    });
    storageUpload.mockResolvedValue({ error: null });
    storageRemove.mockResolvedValue({
      error: { message: "row-level security", statusCode: 403 },
    });
    adminStorageRemove.mockResolvedValue({ error: null });
    intakePhotoSelect.mockResolvedValue({ data: null, error: null });
    createPhotoAdminClient.mockReturnValue(adminClient());
    commitRpc();
  });

  it("rejects checkout_* before any storage work when jobs or QC are not ready", async () => {
    createClient.mockResolvedValue(
      client({
        jobs: [{ job_id: "j1", status: "in_progress" }],
      })
    );
    const file = new File([await tinyJpeg()], "checkout.jpg", { type: "image/jpeg" });

    await expect(
      uploadIntakePhoto(WORK_ORDER_ID, { category: "checkout_front", file })
    ).rejects.toThrow("CHECKOUT_EVIDENCE_NOT_READY");
    expect(storageUpload).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(createPhotoAdminClient).not.toHaveBeenCalled();
  });

  it("rejects checkout_* when jobs are complete but QC is not stamped", async () => {
    createClient.mockResolvedValue(
      client({
        jobs: [{ job_id: "j1", status: "completed" }],
        workOrder: { quality_checked_at: null, quality_checked_by_user_id: null },
      })
    );
    const file = new File([await tinyJpeg()], "checkout.jpg", { type: "image/jpeg" });

    await expect(
      uploadIntakePhoto(WORK_ORDER_ID, { category: "checkout_rear", file })
    ).rejects.toThrow("CHECKOUT_EVIDENCE_NOT_READY");
    expect(storageUpload).not.toHaveBeenCalled();
  });

  it("captures checkout photos after every active job is completed and QC is stamped", async () => {
    createClient.mockResolvedValue(
      client({
        jobs: [{ job_id: "j1", status: "completed" }],
        workOrder: {
          quality_checked_at: "2026-10-01T12:00:00.000Z",
          quality_checked_by_user_id: USER_ID,
        },
      })
    );
    const file = new File([await tinyJpeg()], "checkout.jpg", { type: "image/jpeg" });

    const photo = await uploadIntakePhoto(WORK_ORDER_ID, {
      category: "checkout_front",
      file,
    });

    expect(storageUpload).toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "create_intake_photo_with_event",
      expect.objectContaining({ p_category: "checkout_front" })
    );
    expect(photo.category).toBe("checkout_front");
  });

  it("still uploads legacy non-checkout photos before QC", async () => {
    createClient.mockResolvedValue(
      client({ jobs: [{ job_id: "j1", status: "in_progress" }] })
    );
    const file = new File([await tinyJpeg()], "front.jpg", { type: "image/jpeg" });

    await uploadIntakePhoto(WORK_ORDER_ID, { category: "front", file });
    expect(storageUpload).toHaveBeenCalled();
    expect(rpc).toHaveBeenCalled();
  });

  it("uses photo admin cleanup after insert failure and never user storage DELETE", async () => {
    createClient.mockResolvedValue(client());
    rpc.mockResolvedValue({ data: null, error: { message: "insert failed" } });
    const file = new File([await tinyJpeg()], "front.jpg", { type: "image/jpeg" });

    await expect(
      uploadIntakePhoto(WORK_ORDER_ID, { category: "front", file })
    ).rejects.toThrow(/insert failed|PHOTO_UPLOAD_FAILED/);
    expect(createPhotoAdminClient).toHaveBeenCalled();
    expect(adminStorageRemove).toHaveBeenCalled();
    expect(storageRemove).not.toHaveBeenCalled();
  });

  it("returns the concurrent winner when technician cleanup fails instead of retrying forever", async () => {
    createClient.mockResolvedValue(client());
    const winner = {
      photo_id: WINNER_PHOTO_ID,
      work_order_id: WORK_ORDER_ID,
      uploaded_by_user_id: USER_ID,
      storage_path: `${WORK_ORDER_ID}/front/${WINNER_PHOTO_ID}.jpg`,
      thumb_storage_path: null,
      photo_url: null,
      category: "front",
      notes: null,
      inspection_result_id: null,
      job_id: null,
      client_upload_id: "81111111-1111-4111-8111-111111111111",
      content_type: "image/jpeg",
      byte_size: 4,
      pixel_width: 4,
      pixel_height: 4,
      created_at: "2026-10-01T00:00:00.000Z",
    };
    intakePhotoSelect
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: winner, error: null });
    rpc.mockResolvedValue({
      error: { code: "23505", message: "duplicate key" },
      data: null,
    });
    createPhotoAdminClient.mockImplementation(() => {
      throw new Error("PHOTO_ADMIN_MISCONFIGURED");
    });
    const file = new File([await tinyJpeg()], "front.jpg", { type: "image/jpeg" });

    const photo = await uploadIntakePhoto(WORK_ORDER_ID, {
      category: "front",
      client_upload_id: winner.client_upload_id,
      file,
    });

    expect(photo.photo_id).toBe(WINNER_PHOTO_ID);
    expect(storageRemove).not.toHaveBeenCalled();
  });
});
