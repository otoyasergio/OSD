import { describe, expect, it, vi } from "vitest";
import { uploadQueuedPhoto } from "@/lib/photos/uploadQueue/uploadQueuedPhoto";
import type { QueuedPhotoUpload } from "@/lib/photos/uploadQueue/types";

const ITEM = {
  queueId: "queue-1",
  clientUploadId: "81111111-1111-4111-8111-111111111111",
  userId: "user-a",
  locationId: "location-a",
  workOrderId: "41111111-1111-4111-8111-111111111111",
  category: "front",
  jobId: "51111111-1111-4111-8111-111111111111",
  inspectionResultId: "61111111-1111-4111-8111-111111111111",
  notes: "scratched tank",
  blob: new Blob(["photo-bytes"], { type: "image/jpeg" }),
  fileName: "front.jpg",
  mimeType: "image/jpeg",
  lastModified: 1_700,
  byteCount: 11,
  status: "uploading",
  attemptCount: 0,
  retryAt: null,
  lastError: null,
  createdAt: 1_000,
  updatedAt: 2_000,
  leaseOwner: "runner-a",
  leaseExpiresAt: 32_000,
  uploadSlotOwner: "runner-a",
  uploadSlotExpiresAt: 32_000,
} as QueuedPhotoUpload;

describe("uploadQueuedPhoto", () => {
  it("sends reconstructed file metadata and accepts only a matching confirmation", async () => {
    const uploadIntake = vi.fn(
      async (_workOrderId: string, _prev: unknown, form: FormData) => {
        expect(form.get("client_upload_id")).toBe(ITEM.clientUploadId);
        expect(form.get("category")).toBe("front");
        expect(form.get("notes")).toBe("scratched tank");
        expect(form.get("job_id")).toBe(ITEM.jobId);
        expect(form.get("inspection_result_id")).toBe(ITEM.inspectionResultId);
        const file = form.get("file");
        expect(file).toBeInstanceOf(File);
        expect((file as File).name).toBe("front.jpg");
        expect((file as File).type).toBe("image/jpeg");
        expect((file as File).lastModified).toBe(1_700);
        expect(await (file as File).text()).toBe("photo-bytes");
        return {
          error: null,
          photoId: "71111111-1111-4111-8111-111111111111",
          clientUploadId: ITEM.clientUploadId,
        };
      }
    );

    const outcome = await uploadQueuedPhoto(ITEM, new AbortController().signal, {
      uploadIntakePhoto: uploadIntake,
      uploadAssistantPhoto: vi.fn(),
    });

    expect(uploadIntake).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({
      ok: true,
      photoId: "71111111-1111-4111-8111-111111111111",
    });
  });

  it("treats a mismatched client upload id as a permanent failure", async () => {
    const outcome = await uploadQueuedPhoto(ITEM, new AbortController().signal, {
      uploadIntakePhoto: async () => ({
        error: null,
        photoId: "71111111-1111-4111-8111-111111111111",
        clientUploadId: "91111111-1111-4111-8111-111111111111",
      }),
      uploadAssistantPhoto: vi.fn(),
    });

    expect(outcome).toEqual({
      ok: false,
      retryable: false,
      message: "The server confirmation did not match this photo upload.",
    });
  });

  it("maps transient action errors as retryable and authorization errors as permanent", async () => {
    const transient = await uploadQueuedPhoto(ITEM, new AbortController().signal, {
      uploadIntakePhoto: async () => ({
        error: "Could not upload the photo. Try again.",
      }),
      uploadAssistantPhoto: vi.fn(),
    });
    const forbidden = await uploadQueuedPhoto(ITEM, new AbortController().signal, {
      uploadIntakePhoto: async () => ({
        error: "You do not have permission to upload photos.",
      }),
      uploadAssistantPhoto: vi.fn(),
    });

    expect(transient).toEqual({
      ok: false,
      retryable: true,
      message: "Could not upload the photo. Try again.",
    });
    expect(forbidden).toEqual({
      ok: false,
      retryable: false,
      message: "You do not have permission to upload photos.",
    });
  });

  it("routes diagnostics uploads through the assistant action with the client upload id", async () => {
    const item = {
      ...ITEM,
      assistantThreadId: "71111111-1111-4111-8111-111111111111",
      notes: "Show the left caliper",
    } as QueuedPhotoUpload;
    const uploadAssistant = vi.fn(
      async (_workOrderId: string, _prev: unknown, form: FormData) => {
        expect(form.get("thread_id")).toBe(item.assistantThreadId);
        expect(form.get("purpose")).toBe("Show the left caliper");
        expect(form.get("client_upload_id")).toBe(item.clientUploadId);
        expect(form.get("file")).toBeInstanceOf(File);
        return {
          status: "success" as const,
          error: null,
          data: {
            photoId: "a9111111-1111-4111-8111-111111111111",
            workOrderId: item.workOrderId,
            jobId: item.jobId,
            category: "job_work",
            notes: "Show the left caliper",
            createdAt: "2026-10-01T00:00:00.000Z",
            clientUploadId: item.clientUploadId,
          },
        };
      }
    );

    const outcome = await uploadQueuedPhoto(item, new AbortController().signal, {
      uploadIntakePhoto: vi.fn(),
      uploadAssistantPhoto: uploadAssistant,
    });

    expect(uploadAssistant).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({
      ok: true,
      photoId: "a9111111-1111-4111-8111-111111111111",
    });
  });
});
