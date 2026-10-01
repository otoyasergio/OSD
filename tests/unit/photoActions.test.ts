import { beforeEach, describe, expect, it, vi } from "vitest";

const { revalidatePath, uploadIntakePhoto } = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  uploadIntakePhoto: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/services/photos", () => ({
  deleteIntakePhoto: vi.fn(),
  uploadIntakePhoto,
}));

import { uploadIntakePhotoAction } from "@/app/(app)/work_orders/photo-actions";

const WORK_ORDER_ID = "41111111-1111-4111-8111-111111111111";
const PHOTO_ID = "71111111-1111-4111-8111-111111111111";
const CLIENT_UPLOAD_ID = "81111111-1111-4111-8111-111111111111";

function uploadForm(clientUploadId?: string): FormData {
  const form = new FormData();
  form.set("category", "front");
  form.set(
    "file",
    new File([new Uint8Array([1, 2, 3])], "front.jpg", {
      type: "image/jpeg",
    })
  );
  if (clientUploadId) form.set("client_upload_id", clientUploadId);
  return form;
}

function uploadedPhoto(clientUploadId: string | null) {
  return {
    photo_id: PHOTO_ID,
    work_order_id: WORK_ORDER_ID,
    uploaded_by_user_id: "11111111-1111-4111-8111-111111111111",
    storage_path: `${WORK_ORDER_ID}/front/${PHOTO_ID}.jpg`,
    thumb_storage_path: `${WORK_ORDER_ID}/front/${PHOTO_ID}.thumb.jpg`,
    photo_url: null,
    category: "front",
    notes: null,
    inspection_result_id: null,
    job_id: null,
    client_upload_id: clientUploadId,
    content_type: "image/jpeg",
    byte_size: 3,
    pixel_width: 1,
    pixel_height: 1,
    created_at: "2026-10-01T00:00:00.000Z",
    signed_url: "https://signed.example/full.jpg",
    thumb_url: "https://signed.example/thumb.jpg",
  };
}

describe("uploadIntakePhotoAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes the client upload ID and returns the structured replay confirmation", async () => {
    uploadIntakePhoto.mockResolvedValue(uploadedPhoto(CLIENT_UPLOAD_ID));

    const first = await uploadIntakePhotoAction(
      WORK_ORDER_ID,
      { error: null },
      uploadForm(CLIENT_UPLOAD_ID)
    );
    const replay = await uploadIntakePhotoAction(
      WORK_ORDER_ID,
      { error: null },
      uploadForm(CLIENT_UPLOAD_ID)
    );

    expect(uploadIntakePhoto).toHaveBeenNthCalledWith(
      1,
      WORK_ORDER_ID,
      expect.objectContaining({ client_upload_id: CLIENT_UPLOAD_ID })
    );
    expect(first).toEqual({
      error: null,
      photoId: PHOTO_ID,
      clientUploadId: CLIENT_UPLOAD_ID,
      thumbUrl: "https://signed.example/thumb.jpg",
    });
    expect(replay).toEqual(first);
  });

  it("keeps callers without a client upload ID working", async () => {
    uploadIntakePhoto.mockResolvedValue(uploadedPhoto(null));

    const result = await uploadIntakePhotoAction(
      WORK_ORDER_ID,
      { error: null },
      uploadForm()
    );

    expect(uploadIntakePhoto).toHaveBeenCalledWith(WORK_ORDER_ID, {
      category: "front",
      notes: null,
      inspection_result_id: null,
      file: expect.any(File),
    });
    expect(result).toEqual({
      error: null,
      photoId: PHOTO_ID,
      thumbUrl: "https://signed.example/thumb.jpg",
    });
  });

  it("passes an optional job id through to the intake uploader", async () => {
    const jobId = "51111111-1111-4111-8111-111111111111";
    uploadIntakePhoto.mockResolvedValue(uploadedPhoto(CLIENT_UPLOAD_ID));
    const form = uploadForm(CLIENT_UPLOAD_ID);
    form.set("job_id", jobId);

    await uploadIntakePhotoAction(WORK_ORDER_ID, { error: null }, form);

    expect(uploadIntakePhoto).toHaveBeenCalledWith(
      WORK_ORDER_ID,
      expect.objectContaining({
        job_id: jobId,
        client_upload_id: CLIENT_UPLOAD_ID,
      })
    );
  });
});
