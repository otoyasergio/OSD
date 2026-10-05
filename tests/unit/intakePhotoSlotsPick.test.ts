/** @vitest-environment jsdom */
import { createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  IntakePhotoSlots,
  type IntakePhotoSelection,
} from "@/components/forms/IntakePhotoSlots";
import { usePhotoUploadQueue } from "@/components/photos/PhotoUploadQueueProvider";
import { PhotoUploadQueueProvider } from "@/components/photos/PhotoUploadQueueProvider";
import {
  createMemoryPhotoUploadQueueDatabase,
  MemoryPhotoUploadQueueStore,
} from "@/tests/helpers/memoryPhotoUploadQueueStore";

describe("IntakePhotoSlots pick flow", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
  });

  it("clones a library photo before the input is cleared", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: () => "blob:preview",
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: () => undefined,
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const onChange = vi.fn();
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    await act(async () => {
      root!.render(
        createElement(
          PhotoUploadQueueProvider,
          {
            userId: "user-a",
            locationId: "location-a",
            store,
            isOnline: () => false,
          },
          createElement(IntakePhotoSlots, {
            value: {},
            onChange,
            htmlRequired: false,
            intakeDraftId: "draft-1",
          })
        )
      );
    });

    const input = container!.querySelector(
      'input[aria-label="Front photo library"]'
    ) as HTMLInputElement;
    expect(input).toBeTruthy();

    const original = new File(["tiny-jpeg-bytes"], "library.jpg", {
      type: "image/jpeg",
    });
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [original],
    });

    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await vi.waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
    });
    const next = onChange.mock.calls[0][0] as { front: File };
    expect(next.front).toBeInstanceOf(File);
    expect(next.front).not.toBe(original);
    expect(await next.front.text()).toBe("tiny-jpeg-bytes");
    expect(input.value).toBe("");
  });

  it("keeps a library photo that reports size 0 until it is read", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: () => "blob:preview",
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: () => undefined,
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const onChange = vi.fn();
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    await act(async () => {
      root!.render(
        createElement(
          PhotoUploadQueueProvider,
          {
            userId: "user-a",
            locationId: "location-a",
            store,
            isOnline: () => false,
          },
          createElement(IntakePhotoSlots, {
            value: {},
            onChange,
            htmlRequired: false,
            intakeDraftId: "draft-1",
          })
        )
      );
    });

    const input = container!.querySelector(
      'input[aria-label="Front photo library"]'
    ) as HTMLInputElement;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const original = new File([bytes], "IMG_1234.HEIC", { type: "" });
    Object.defineProperty(original, "size", { configurable: true, value: 0 });
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [original],
    });

    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await vi.waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
    });
    const next = onChange.mock.calls[0][0] as { front: File };
    expect(next.front).not.toBe(original);
    expect(next.front.size).toBe(bytes.byteLength);
    expect(next.front.type).toBe("image/jpeg");
    expect(input.value).toBe("");
  });

  it("keeps the front photo after the draft is attached to a work order", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: () => "blob:preview",
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: () => undefined,
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    function Harness() {
      const queue = usePhotoUploadQueue();
      const [value, setValue] = useState<IntakePhotoSelection>({});
      return createElement(
        "div",
        null,
        createElement(
          "button",
          {
            type: "button",
            onClick: () => {
              void queue.attachDraftToWorkOrder("draft-1", "wo-1");
            },
          },
          "Attach"
        ),
        createElement(IntakePhotoSlots, {
          value,
          onChange: setValue,
          htmlRequired: false,
          intakeDraftId: "draft-1",
        })
      );
    }

    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    await act(async () => {
      root!.render(
        createElement(
          PhotoUploadQueueProvider,
          {
            userId: "user-a",
            locationId: "location-a",
            store,
            isOnline: () => false,
          },
          createElement(Harness)
        )
      );
    });

    const input = container!.querySelector(
      'input[aria-label="Front photo library"]'
    ) as HTMLInputElement;
    const original = new File(["tiny-jpeg-bytes"], "library.jpg", {
      type: "image/jpeg",
    });
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [original],
    });

    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await vi.waitFor(() => {
      expect(container!.querySelector('img[alt="Front preview"]')).toBeTruthy();
    });

    const attach = Array.from(container!.querySelectorAll("button")).find(
      (button) => button.textContent === "Attach"
    );
    await act(async () => {
      attach!.click();
    });

    await vi.waitFor(() => {
      const front = container!.querySelector('button[aria-label="Retake Front photo"]');
      expect(front?.textContent).toContain("Photo ready");
    });
    const front = container!.querySelector('button[aria-label="Retake Front photo"]');
    expect(front?.textContent).not.toContain("Tap to add photo");
  });
});
