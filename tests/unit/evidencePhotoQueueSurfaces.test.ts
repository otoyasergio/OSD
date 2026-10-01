/** @vitest-environment jsdom */
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InspectionPhotoSlot } from "@/components/inspections/InspectionPhotoSlot";
import { PhotosTab } from "@/components/photos/PhotosTab";
import { PhotoUploadQueueProvider } from "@/components/photos/PhotoUploadQueueProvider";
import { FloorPhotoField } from "@/components/technician/FloorPhotoField";
import { UNREADABLE_PHOTO_MESSAGE } from "@/lib/forms/photoUploadErrors";
import {
  createMemoryPhotoUploadQueueDatabase,
  MemoryPhotoUploadQueueStore,
} from "@/tests/helpers/memoryPhotoUploadQueueStore";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

function photoFile(name = "shot.jpg", bytes = "jpeg-bytes"): File {
  return new File([bytes], name, { type: "image/jpeg", lastModified: 1_700 });
}

describe("evidence photo queue surfaces", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    URL.createObjectURL = vi.fn(() => "blob:evidence") as never;
    URL.revokeObjectURL = vi.fn() as never;
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("inspection slot enqueues a picked photo instead of posting bytes", async () => {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    await act(async () => {
      root.render(
        createElement(
          PhotoUploadQueueProvider,
          {
            userId: "user-a",
            locationId: "location-a",
            store,
            isOnline: () => false,
          },
          createElement(InspectionPhotoSlot, {
            workOrderId: "wo-1",
            category: "inspection_tires",
            inspectionResultId: "ir-1",
            label: "Tires",
          })
        )
      );
    });

    const input = container.querySelector(
      'input[aria-label="Tires photo library"]'
    ) as HTMLInputElement;
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [photoFile("tires.jpg")],
    });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await vi.waitFor(async () => {
      expect(
        await store.list({ userId: "user-a", locationId: "location-a" })
      ).toHaveLength(1);
    });
    expect(
      (await store.list({ userId: "user-a", locationId: "location-a" }))[0]
    ).toMatchObject({
      category: "inspection_tires",
      workOrderId: "wo-1",
      inspectionResultId: "ir-1",
    });
  });

  it("Photos tab enqueues category and notes", async () => {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    await act(async () => {
      root.render(
        createElement(
          PhotoUploadQueueProvider,
          {
            userId: "user-a",
            locationId: "location-a",
            store,
            isOnline: () => false,
          },
          createElement(PhotosTab, {
            photos: [],
            readOnly: false,
            canUpload: true,
            canDelete: false,
            workOrderId: "wo-1",
            deleteAction: async () => ({ error: null }),
          })
        )
      );
    });

    const notes = container.querySelector(
      'input[name="notes"], textarea[name="notes"]'
    ) as HTMLInputElement | HTMLTextAreaElement;
    expect(notes).toBeTruthy();
    await act(async () => {
      notes.value = "scratched tank";
      notes.dispatchEvent(new Event("input", { bubbles: true }));
      notes.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const library = container.querySelector(
      'input[aria-label="Photo library"]'
    ) as HTMLInputElement;
    Object.defineProperty(library, "files", {
      configurable: true,
      value: [photoFile("front.jpg")],
    });
    await act(async () => {
      library.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await vi.waitFor(async () => {
      expect(
        await store.list({ userId: "user-a", locationId: "location-a" })
      ).toHaveLength(1);
    });
    expect(
      (await store.list({ userId: "user-a", locationId: "location-a" }))[0]
    ).toMatchObject({
      category: "front",
      workOrderId: "wo-1",
      notes: "scratched tank",
    });
  });

  it("Photos tab upload options exclude categories that require job or inspection linkage", async () => {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    await act(async () => {
      root.render(
        createElement(
          PhotoUploadQueueProvider,
          {
            userId: "user-a",
            locationId: "location-a",
            store,
            isOnline: () => false,
          },
          createElement(PhotosTab, {
            photos: [],
            readOnly: false,
            canUpload: true,
            canDelete: false,
            workOrderId: "wo-1",
            deleteAction: async () => ({ error: null }),
          })
        )
      );
    });

    const uploadSelect = container.querySelector(
      'select[name="category"]'
    ) as HTMLSelectElement;
    const uploadValues = Array.from(uploadSelect.options).map((option) => option.value);
    expect(uploadValues).toContain("front");
    expect(uploadValues).toContain("other");
    expect(uploadValues).not.toContain("job_proof");
    expect(uploadValues).not.toContain("job_work");
    expect(uploadValues.filter((value) => value.startsWith("inspection_"))).toEqual([]);
  });

  it("floor picker shows the unreadable-file error", async () => {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    await act(async () => {
      root.render(
        createElement(
          PhotoUploadQueueProvider,
          {
            userId: "user-a",
            locationId: "location-a",
            store,
            isOnline: () => false,
          },
          createElement(FloorPhotoField, {
            hint: "Camera or photo library",
            workOrderId: "wo-1",
            jobId: "job-1",
            category: "job_proof",
          })
        )
      );
    });

    const input = container.querySelector(
      'input[aria-label="Choose from library"]'
    ) as HTMLInputElement;
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File([], "broken.jpg", { type: "image/jpeg" })],
    });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain(UNREADABLE_PHOTO_MESSAGE);
    });
    expect(await store.list({ userId: "user-a", locationId: "location-a" })).toHaveLength(
      0
    );
  });

  it("floor picker enqueues job_proof photos", async () => {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    await act(async () => {
      root.render(
        createElement(
          PhotoUploadQueueProvider,
          {
            userId: "user-a",
            locationId: "location-a",
            store,
            isOnline: () => false,
          },
          createElement(FloorPhotoField, {
            hint: "Camera or photo library",
            workOrderId: "wo-1",
            jobId: "job-1",
            category: "job_proof",
          })
        )
      );
    });

    const input = container.querySelector(
      'input[aria-label="Choose from library"]'
    ) as HTMLInputElement;
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [photoFile("proof.jpg")],
    });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await vi.waitFor(async () => {
      expect(
        await store.list({ userId: "user-a", locationId: "location-a" })
      ).toHaveLength(1);
    });
    expect(
      (await store.list({ userId: "user-a", locationId: "location-a" }))[0]
    ).toMatchObject({
      category: "job_proof",
      workOrderId: "wo-1",
      jobId: "job-1",
    });
    expect(container.textContent).toMatch(/Waiting for connection|Photo queued/);
  });

  it("floor picker hydrates receipt Saved state after remount", async () => {
    const database = createMemoryPhotoUploadQueueDatabase();
    const store = new MemoryPhotoUploadQueueStore(database);
    await store.put(
      { userId: "user-a", locationId: "location-a" },
      {
        queueId: "proof-1",
        clientUploadId: "client-1",
        userId: "user-a",
        locationId: "location-a",
        workOrderId: "wo-1",
        jobId: "job-1",
        category: "job_proof",
        blob: new Blob(["x"], { type: "image/jpeg" }),
        fileName: "proof.jpg",
        mimeType: "image/jpeg",
        lastModified: 1,
        byteCount: 1,
        status: "uploading",
        attemptCount: 0,
        retryAt: null,
        lastError: null,
        createdAt: 1,
        updatedAt: 1,
        leaseOwner: "runner-a",
        leaseExpiresAt: 9_999,
        uploadSlotOwner: "runner-a",
        uploadSlotExpiresAt: 9_999,
      }
    );
    await store.completeClaimedUpload(
      "proof-1",
      { userId: "user-a", locationId: "location-a" },
      "runner-a",
      2_000,
      { photoId: "photo-proof", clientUploadId: "client-1" }
    );

    await act(async () => {
      root.render(
        createElement(
          PhotoUploadQueueProvider,
          {
            userId: "user-a",
            locationId: "location-a",
            store: new MemoryPhotoUploadQueueStore(database),
            isOnline: () => true,
            now: () => 2_500,
          },
          createElement(FloorPhotoField, {
            hint: "Camera or photo library",
            workOrderId: "wo-1",
            jobId: "job-1",
            category: "job_proof",
          })
        )
      );
    });

    await vi.waitFor(() => {
      expect(container.textContent).toMatch(/Saved/);
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("refreshes once when a durable receipt photo is missing from server props", async () => {
    const database = createMemoryPhotoUploadQueueDatabase();
    const store = new MemoryPhotoUploadQueueStore(database);
    database.confirmations.set("receipt-1", {
      queueId: "receipt-1",
      clientUploadId: "client-1",
      photoId: "photo-from-queue",
      userId: "user-a",
      locationId: "location-a",
      confirmedAt: Date.now(),
      category: "front",
      workOrderId: "wo-1",
    });

    function renderTab(
      photos: Array<{
        photo_id: string;
        work_order_id: string;
        category: string;
        notes: string | null;
        created_at: string;
        uploaded_by: null;
        signed_url: string | null;
        thumb_url: string | null;
      }>
    ) {
      return act(async () => {
        root.render(
          createElement(
            PhotoUploadQueueProvider,
            {
              userId: "user-a",
              locationId: "location-a",
              store,
              isOnline: () => true,
            },
            createElement(PhotosTab, {
              photos: photos as never,
              readOnly: false,
              canUpload: true,
              canDelete: false,
              workOrderId: "wo-1",
              deleteAction: async () => ({ error: null }),
            })
          )
        );
      });
    }

    await renderTab([]);
    await vi.waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    await renderTab([
      {
        photo_id: "photo-from-queue",
        work_order_id: "wo-1",
        category: "front",
        notes: null,
        created_at: "2026-10-01T00:00:00.000Z",
        uploaded_by: null,
        signed_url: "/front.jpg",
        thumb_url: "/front-thumb.jpg",
      },
    ]);
    await act(async () => {
      await Promise.resolve();
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
