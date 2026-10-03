/** @vitest-environment jsdom */
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PhotosTab } from "@/components/photos/PhotosTab";
import { PhotoUploadQueueProvider } from "@/components/photos/PhotoUploadQueueProvider";
import {
  createMemoryPhotoUploadQueueDatabase,
  MemoryPhotoUploadQueueStore,
} from "@/tests/helpers/memoryPhotoUploadQueueStore";
import type { IntakePhoto } from "@/lib/services/photos";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

const WORK_ORDER_ID = "41111111-1111-4111-8111-111111111111";
const PHOTO_ID = "71111111-1111-4111-8111-111111111111";

const PHOTO_ID_B = "72111111-1111-4111-8111-111111111111";

function samplePhoto(overrides: Partial<IntakePhoto> = {}): IntakePhoto {
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
    client_upload_id: null,
    content_type: "image/jpeg",
    byte_size: 12,
    pixel_width: 4,
    pixel_height: 4,
    created_at: "2026-09-01T14:22:00.000Z",
    signed_url: "https://signed.example/front.jpg",
    thumb_url: "https://signed.example/front.thumb.jpg",
    uploaded_by: { user_id: "u1", first_name: "Ada", last_name: "Tech" },
    ...overrides,
  };
}

describe("PhotosTab corrective delete confirmation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
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

  async function renderTab(
    deleteAction: (
      state: { error: string | null },
      formData: FormData
    ) => Promise<{
      error: string | null;
    }>,
    photos: IntakePhoto[] = [samplePhoto()]
  ) {
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
            photos,
            readOnly: false,
            canUpload: false,
            canDelete: true,
            workOrderId: WORK_ORDER_ID,
            deleteAction,
          })
        )
      );
    });
  }

  it("requires a confirmation reason and does not delete on the first tap", async () => {
    const deleteAction = vi.fn(async () => ({ error: null }));
    await renderTab(deleteAction);

    const remove = container.querySelector(
      'button[aria-label="Remove Front photo"]'
    ) as HTMLButtonElement;
    expect(remove).toBeTruthy();
    expect(remove.type).toBe("button");
    expect(container.querySelector('textarea[name="reason"]')).toBeNull();

    await act(async () => {
      remove.click();
    });

    expect(deleteAction).not.toHaveBeenCalled();
    expect(container.querySelector('textarea[name="reason"]')).toBeTruthy();
    expect(container.querySelector('input[name="photo_id"]')).toBeTruthy();
    expect(container.textContent).toMatch(/Front/);
  });

  it("Cancel leaves the photo and does not call the delete action", async () => {
    const deleteAction = vi.fn(async () => ({ error: null }));
    await renderTab(deleteAction);

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Remove Front photo"]')!
        .click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")!;
      const cancel = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent?.trim() === "Cancel"
      );
      cancel?.click();
    });

    expect(deleteAction).not.toHaveBeenCalled();
    expect(container.querySelector('textarea[name="reason"]')).toBeNull();
    expect(container.textContent).toMatch(/Front/);
    expect(
      container.querySelector('button[aria-label="Remove Front photo"]')
    ).toBeTruthy();
  });

  it("disables every Remove button while a delete is pending", async () => {
    let release: ((value: { error: null }) => void) | undefined;
    const deleteAction = vi.fn(
      () =>
        new Promise<{ error: null }>((resolve) => {
          release = resolve;
        })
    );
    await renderTab(deleteAction, [
      samplePhoto(),
      samplePhoto({
        photo_id: PHOTO_ID_B,
        category: "rear",
        storage_path: `${WORK_ORDER_ID}/rear/${PHOTO_ID_B}.jpg`,
        thumb_storage_path: `${WORK_ORDER_ID}/rear/${PHOTO_ID_B}.thumb.jpg`,
      }),
    ]);

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Remove Front photo"]')!
        .click();
    });
    await act(async () => {
      container.querySelector<HTMLTextAreaElement>('textarea[name="reason"]')!.value =
        "wrong angle";
      container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    });

    await vi.waitFor(() => {
      expect(deleteAction).toHaveBeenCalled();
    });

    const rearRemove = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove Rear photo"]'
    );
    expect(rearRemove?.disabled).toBe(true);
    expect(
      Array.from(container.querySelectorAll("button")).every((button) => {
        const label = button.getAttribute("aria-label") ?? button.textContent ?? "";
        return !/remove/i.test(label) || button.disabled;
      })
    ).toBe(true);

    await act(async () => {
      release?.({ error: null });
    });
  });
});
