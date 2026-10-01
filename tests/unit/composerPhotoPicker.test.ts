/** @vitest-environment jsdom */
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readPickedPhotoFiles } from "@/lib/forms/readPickedPhotoFiles";
import { uploadChatImageAction } from "@/app/(app)/messages/actions";

vi.mock("@/lib/forms/readPickedPhotoFiles", () => ({
  readPickedPhotoFiles: vi.fn(),
}));

vi.mock("@/app/(app)/messages/actions", () => ({
  sendMessageAction: vi.fn(),
  uploadChatImageAction: vi.fn(),
  uploadVoiceNoteAction: vi.fn(),
}));

import { Composer } from "@/components/messages/Composer";

const JPEG = new File([Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])], "shot.jpg", {
  type: "image/jpeg",
});

describe("Composer photo picker while upload is pending", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
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

  it("blocks a second pick while the current upload is pending", async () => {
    vi.mocked(readPickedPhotoFiles).mockResolvedValue([JPEG]);
    vi.mocked(uploadChatImageAction).mockImplementation(() => new Promise(() => {}));

    await act(async () => {
      root.render(createElement(Composer, { conversationId: "convo-1" }));
    });

    const input = container.querySelector("input[type='file']") as HTMLInputElement;
    const label = container.querySelector("label") as HTMLLabelElement;
    const wrapper = input.parentElement;
    expect(wrapper?.className).toMatch(/relative/);
    expect(label.getAttribute("for")).toBe(input.id);

    Object.defineProperty(input, "files", { configurable: true, value: [JPEG] });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await vi.waitFor(() => expect(uploadChatImageAction).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(input.disabled).toBe(true));

    expect(label.getAttribute("aria-disabled")).toBe("true");
    expect(label.className).toMatch(/pointer-events-none/);
    expect(label.getAttribute("for")).toBeNull();

    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File([JPEG], "second.jpg", { type: "image/jpeg" })],
    });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(readPickedPhotoFiles).toHaveBeenCalledTimes(1);
    expect(uploadChatImageAction).toHaveBeenCalledTimes(1);
  });
});
