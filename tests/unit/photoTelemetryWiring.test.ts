import { afterEach, describe, expect, it, vi } from "vitest";
import { UNREADABLE_PHOTO_MESSAGE } from "@/lib/forms/photoUploadErrors";
import { readPickedPhotoFiles } from "@/lib/forms/readPickedPhotoFiles";
import { readPickedUploadFiles } from "@/lib/forms/readPickedUploadFiles";
import {
  emitPhotoTelemetry,
  resetPhotoTelemetrySink,
  setPhotoTelemetrySink,
} from "@/lib/photos/telemetry";
import { enqueuePhotoUpload } from "@/lib/photos/uploadQueue/enqueue";
import { PhotoUploadQueueRunner } from "@/lib/photos/uploadQueue/runner";
import { PhotoQueuePersistenceError } from "@/lib/photos/uploadQueue/errors";
import { reconcileIntakePhotos } from "@/lib/photos/reconcileIntakePhotos";
import {
  createMemoryPhotoUploadQueueDatabase,
  MemoryPhotoUploadQueueStore,
} from "@/tests/helpers/memoryPhotoUploadQueueStore";
import type { PhotoUploadScope, QueuedPhotoUpload } from "@/lib/photos/uploadQueue/types";

const SCOPE: PhotoUploadScope = { userId: "user-a", locationId: "location-a" };

function queuedPhoto(overrides: Partial<QueuedPhotoUpload> = {}): QueuedPhotoUpload {
  return {
    queueId: "queue-1",
    clientUploadId: "client-upload-1",
    userId: SCOPE.userId,
    locationId: SCOPE.locationId,
    workOrderId: "work-order-1",
    category: "front",
    blob: new Blob(["photo-bytes"], { type: "image/jpeg" }),
    fileName: "front.jpg",
    mimeType: "image/jpeg",
    lastModified: 900,
    pixelWidth: 640,
    pixelHeight: 480,
    byteCount: 11,
    status: "queued",
    attemptCount: 0,
    retryAt: null,
    lastError: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    leaseOwner: null,
    leaseExpiresAt: null,
    uploadSlotOwner: null,
    uploadSlotExpiresAt: null,
    ...overrides,
  } as QueuedPhotoUpload;
}

function fakeInput(files: File[]): HTMLInputElement {
  return {
    files,
    value: "C:\\fakepath\\library.jpg",
  } as unknown as HTMLInputElement;
}

describe("photo telemetry wiring", () => {
  afterEach(() => {
    resetPhotoTelemetrySink();
  });

  it("emits photo_prepare_failed once from readPickedPhotoFiles when nothing is usable", async () => {
    const sink = vi.fn();
    setPhotoTelemetrySink(sink);
    const input = fakeInput([new File([], "empty.jpg", { type: "image/jpeg" })]);

    await expect(readPickedPhotoFiles(input, { surface: "composer" })).rejects.toThrow(
      UNREADABLE_PHOTO_MESSAGE
    );

    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0]).toEqual({
      name: "photo_prepare_failed",
      surface: "composer",
      errorCode: "empty",
    });
    expect(JSON.stringify(sink.mock.calls)).not.toContain("empty.jpg");
  });

  it("emits photo_prepare_failed once from the generic picker catch", async () => {
    const sink = vi.fn();
    setPhotoTelemetrySink(sink);
    const input = fakeInput([
      new File([new Uint8Array([0x00, 0x01])], "note.txt", { type: "text/plain" }),
    ]);

    await expect(
      readPickedUploadFiles(input, { surface: "customer_documents" })
    ).rejects.toThrow(UNREADABLE_PHOTO_MESSAGE);

    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0]).toEqual({
      name: "photo_prepare_failed",
      surface: "customer_documents",
      errorCode: "invalid_type",
    });
    expect(JSON.stringify(sink.mock.calls)).not.toContain("note.txt");
  });

  it("does not emit photo_queue_resumed when the runner starts with no pending work", async () => {
    const sink = vi.fn();
    setPhotoTelemetrySink(sink);
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    const runner = new PhotoUploadQueueRunner({
      scope: SCOPE,
      store,
      uploader: vi.fn(),
      now: () => 2_000,
      timer: {
        setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
        clearTimeout: (handle) => clearTimeout(handle as number),
      },
      isOnline: () => true,
      isVisible: () => true,
      eventTarget: new EventTarget(),
      ownerId: "runner-empty",
    });

    await runner.start();
    runner.stop();

    expect(sink.mock.calls.map((call) => call[0].name)).not.toContain(
      "photo_queue_resumed"
    );
  });

  it("emits photo_queue_quota_failed once when enqueue hits quota", async () => {
    const sink = vi.fn();
    setPhotoTelemetrySink(sink);
    class QuotaFailingStore extends MemoryPhotoUploadQueueStore {
      override async put(): Promise<void> {
        throw new DOMException("Storage quota exceeded.", "QuotaExceededError");
      }
    }
    const store = new QuotaFailingStore(createMemoryPhotoUploadQueueDatabase());

    await expect(
      enqueuePhotoUpload({
        store,
        scope: SCOPE,
        item: queuedPhoto({ status: "preparing" }),
        now: 2_000,
        surface: "photos_tab",
      })
    ).rejects.toBeInstanceOf(PhotoQueuePersistenceError);

    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0]).toEqual({
      name: "photo_queue_quota_failed",
      surface: "photos_tab",
    });
  });

  it("emits resume, retry, and confirm once at the runner boundaries", async () => {
    const sink = vi.fn();
    setPhotoTelemetrySink(sink);
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    await store.put(
      SCOPE,
      queuedPhoto({
        createdAt: 2_000 - 3 * 60_000,
        updatedAt: 2_000 - 3 * 60_000,
      })
    );
    const events = new EventTarget();
    const uploader = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, retryable: true, message: "Failed to fetch" })
      .mockResolvedValueOnce({ ok: true, photoId: "photo-1" });
    const now = { value: 2_000 };
    const runner = new PhotoUploadQueueRunner({
      scope: SCOPE,
      store,
      uploader,
      now: () => now.value,
      timer: {
        setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
        clearTimeout: (handle) => clearTimeout(handle as number),
      },
      isOnline: () => true,
      isVisible: () => true,
      eventTarget: events,
      ownerId: "runner-a",
      baseRetryDelayMs: 1,
      maxRetryDelayMs: 1,
    });

    await runner.start();
    await vi.waitFor(() =>
      expect(sink.mock.calls.some((call) => call[0].name === "photo_queue_resumed")).toBe(
        true
      )
    );
    await vi.waitFor(() =>
      expect(sink.mock.calls.some((call) => call[0].name === "photo_queue_retry")).toBe(
        true
      )
    );

    now.value = 2_050;
    events.dispatchEvent(new Event("online"));
    await vi.waitFor(() =>
      expect(
        sink.mock.calls.some((call) => call[0].name === "photo_upload_confirmed")
      ).toBe(true)
    );
    runner.stop();

    const names = sink.mock.calls.map((call) => call[0].name);
    expect(names.filter((name) => name === "photo_queue_resumed")).toHaveLength(1);
    expect(names.filter((name) => name === "photo_queue_retry")).toHaveLength(1);
    expect(names.filter((name) => name === "photo_upload_confirmed")).toHaveLength(1);
    expect(
      sink.mock.calls.find((call) => call[0].name === "photo_queue_resumed")?.[0]
    ).toEqual({
      name: "photo_queue_resumed",
      pendingCount: 1,
      oldestAgeBucket: "1_5m",
    });
    expect(
      sink.mock.calls.find((call) => call[0].name === "photo_queue_retry")?.[0]
    ).toEqual({
      name: "photo_queue_retry",
      settledFailureCount: 1,
      retryable: true,
    });
    expect(
      sink.mock.calls.find((call) => call[0].name === "photo_upload_confirmed")?.[0]
    ).toMatchObject({
      name: "photo_upload_confirmed",
      category: "front",
    });
    expect(JSON.stringify(sink.mock.calls)).not.toContain("front.jpg");
    expect(JSON.stringify(sink.mock.calls)).not.toContain("Failed to fetch");
    expect(JSON.stringify(sink.mock.calls)).not.toContain("work-order-1");
  });

  it("emits photo_thumbnail_failed from the Task 2 logger without identifiers", async () => {
    const sink = vi.fn();
    setPhotoTelemetrySink(sink);
    const { logIntakeThumbnailFailure } =
      await import("@/lib/photos/intakeThumbnailTelemetry");

    logIntakeThumbnailFailure({
      workOrderId: "41111111-1111-4111-8111-111111111111",
      photoId: "71111111-1111-4111-8111-111111111111",
      stage: "upload",
      statusCode: "503",
      message: "https://signed.example/private-thumb.jpg?token=abc",
    });

    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0]).toEqual({
      name: "photo_thumbnail_failed",
      stage: "upload",
      statusClass: "5xx",
    });
    expect(JSON.stringify(sink.mock.calls)).not.toContain("41111111");
    expect(JSON.stringify(sink.mock.calls)).not.toContain("signed.example");
  });

  it("emits photo_reconciliation_summary once with counts only", async () => {
    const sink = vi.fn();
    setPhotoTelemetrySink(sink);

    const report = await reconcileIntakePhotos(
      {
        async listPhotoPage() {
          return [];
        },
        async listStoragePage() {
          return [];
        },
      },
      { repairThumbnails: false }
    );

    expect(report.counts.rows).toBe(0);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0]).toEqual({
      name: "photo_reconciliation_summary",
      counts: report.counts,
    });
  });

  it("keeps picker and reconcile working when the sink throws", async () => {
    setPhotoTelemetrySink(() => {
      throw new Error("https://signed.example/token=abc IMG_1234.HEIC");
    });

    const input = fakeInput([
      new File([Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])], "shot.jpg", {
        type: "image/jpeg",
      }),
    ]);
    await expect(
      readPickedPhotoFiles(input, { surface: "composer" })
    ).resolves.toHaveLength(1);

    await expect(
      reconcileIntakePhotos(
        {
          async listPhotoPage() {
            return [];
          },
          async listStoragePage() {
            return [];
          },
        },
        { repairThumbnails: false }
      )
    ).resolves.toMatchObject({ counts: { rows: 0 } });

    expect(() =>
      emitPhotoTelemetry({ name: "photo_queue_quota_failed", surface: "photos_tab" })
    ).not.toThrow();
  });
});
