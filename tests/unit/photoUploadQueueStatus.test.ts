/** @vitest-environment jsdom */
import { createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PhotoUploadQueueProvider } from "@/components/photos/PhotoUploadQueueProvider";
import { PhotoUploadQueueStatus } from "@/components/photos/PhotoUploadQueueStatus";
import { SignOutButton } from "@/components/layout/SignOutButton";
import {
  createMemoryPhotoUploadQueueDatabase,
  MemoryPhotoUploadQueueStore,
} from "@/tests/helpers/memoryPhotoUploadQueueStore";
import { usePhotoUploadQueue } from "@/components/photos/PhotoUploadQueueProvider";

const { signOutAction } = vi.hoisted(() => ({
  signOutAction: vi.fn(),
}));

vi.mock("@/app/(app)/actions/sign-out", () => ({ signOutAction }));

function EnqueueOnce({
  category,
  workOrderId,
  fileName,
}: {
  category: string;
  workOrderId?: string;
  fileName: string;
}): ReactNode {
  const api = usePhotoUploadQueue();
  return createElement(
    "button",
    {
      type: "button",
      onClick: () =>
        void api.enqueue({
          file: new File(["bytes"], fileName, { type: "image/jpeg" }),
          category,
          workOrderId,
          intakeDraftId: workOrderId ? undefined : "draft-1",
        }),
    },
    `enqueue ${category}`
  );
}

describe("photo upload queue status and sign-out", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    URL.createObjectURL = vi.fn(() => "blob:status") as never;
    URL.revokeObjectURL = vi.fn() as never;
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  async function renderStatus(isOnline = false) {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    await act(async () => {
      root.render(
        createElement(
          PhotoUploadQueueProvider,
          {
            userId: "user-a",
            locationId: "location-a",
            store,
            isOnline: () => isOnline,
            uploadIntakePhoto: async () => ({
              error: "Could not upload the photo. Try again.",
            }),
          },
          createElement(PhotoUploadQueueStatus),
          createElement(SignOutButton),
          createElement(EnqueueOnce, {
            category: "front",
            workOrderId: "work-order-1",
            fileName: "front.jpg",
          })
        )
      );
    });
    return store;
  }

  it("shows offline waiting copy, retry, remove, and accessible counts", async () => {
    await renderStatus(false);
    const enqueue = container.querySelector("button") as HTMLButtonElement;
    // The first button may be sign-out; click the enqueue control.
    const enqueueButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("enqueue")
    )!;
    await act(async () => {
      enqueueButton.click();
    });

    await vi.waitFor(() => {
      expect(container.textContent).toMatch(/1 photo waiting|1 photos waiting/i);
    });
    expect(container.textContent).toMatch(
      /saved on this device — waiting for connection/i
    );

    const toggle = container.querySelector(
      '[aria-haspopup="true"], button[aria-expanded]'
    ) as HTMLButtonElement | null;
    if (toggle) {
      await act(async () => {
        toggle.click();
      });
    }

    expect(container.textContent).toMatch(/front/i);
    expect(container.textContent).toMatch(/work-order-1|work order/i);
    expect(container.querySelector("button[aria-label^='Retry']")).toBeTruthy();
    expect(container.querySelector("button[aria-label^='Remove']")).toBeTruthy();
    expect(enqueue).toBeTruthy();
  });

  it("warns before sign-out when scoped queue items remain", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await renderStatus(false);
    const enqueueButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("enqueue")
    )!;
    await act(async () => {
      enqueueButton.click();
    });
    await vi.waitFor(() => {
      expect(container.textContent).toMatch(/waiting/i);
    });

    const signOut = Array.from(container.querySelectorAll("button")).find((button) =>
      /sign out/i.test(button.textContent ?? "")
    )!;
    await act(async () => {
      signOut.click();
    });

    expect(confirm).toHaveBeenCalled();
    expect(String(confirm.mock.calls[0]?.[0])).toMatch(
      /resume only when the same user signs in on this device/i
    );
    expect(signOutAction).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await act(async () => {
      signOut.click();
    });
    expect(signOutAction).toHaveBeenCalled();
  });
});
