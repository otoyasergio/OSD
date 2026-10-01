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

    const notes = container.querySelector(
      'input[name="notes"], textarea[name="notes"]'
    ) as HTMLInputElement | HTMLTextAreaElement | null;
    if (notes) {
      await act(async () => {
        notes.value = "scratched tank";
        notes.dispatchEvent(new Event("input", { bubbles: true }));
        notes.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }

    const submit = Array.from(container.querySelectorAll("button")).find((button) =>
      /upload photo/i.test(button.textContent ?? "")
    );
    expect(submit).toBeTruthy();
    await act(async () => {
      submit!.click();
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
  });
});
