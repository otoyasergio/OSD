/** @vitest-environment jsdom */
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IntakePhotoSlots } from "@/components/forms/IntakePhotoSlots";

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
    await act(async () => {
      root!.render(
        createElement(IntakePhotoSlots, {
          value: {},
          onChange,
          htmlRequired: false,
        })
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
});
