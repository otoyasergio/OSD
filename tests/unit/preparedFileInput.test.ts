/** @vitest-environment jsdom */
import { createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreparedFileInput } from "@/components/forms/PreparedFileInput";
import { UNREADABLE_PHOTO_MESSAGE } from "@/lib/forms/photoUploadErrors";
import { readPickedUploadFiles } from "@/lib/forms/readPickedUploadFiles";

vi.mock("@/lib/forms/readPickedUploadFiles", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/forms/readPickedUploadFiles")>();
  return {
    ...actual,
    readPickedUploadFiles: vi.fn(actual.readPickedUploadFiles),
  };
});

const JPEG_HEADER = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PDF_HEADER = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

describe("PreparedFileInput", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
  });

  function render(
    props: {
      name?: string;
      accept?: string;
      onPrepared?: (files: File[]) => void;
      onPreparingChange?: (preparing: boolean) => void;
      required?: boolean;
    } = {}
  ) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    function Harness() {
      const [preparing, setPreparing] = useState(false);
      return createElement(
        "form",
        null,
        createElement("label", { htmlFor: "prep-input" }, "Choose file"),
        createElement(PreparedFileInput, {
          id: "prep-input",
          name: props.name,
          accept: props.accept ?? "application/pdf,image/jpeg,image/heic",
          onPrepared: props.onPrepared,
          onPreparingChange: (next) => {
            setPreparing(next);
            props.onPreparingChange?.(next);
          },
          required: props.required,
          surface: "customer_documents",
        }),
        createElement("button", { type: "submit", disabled: preparing }, "Upload")
      );
    }

    act(() => {
      root!.render(createElement(Harness));
    });
    return container;
  }

  it("uses an in-flow photo-file-input activated by a native label, never click()", () => {
    const node = render();
    const input = node.querySelector("input[type='file']") as HTMLInputElement;
    const label = node.querySelector("label");
    const source = PreparedFileInput.toString();

    expect(input).toBeTruthy();
    expect(input.className).toContain("photo-file-input");
    expect(input.className).not.toMatch(/\bhidden\b/);
    expect(input.style.display).not.toBe("none");
    expect(label?.getAttribute("for")).toBe("prep-input");
    expect(input.id).toBe("prep-input");
    expect(source).not.toMatch(/\.click\(/);
  });

  it("exposes Preparing, then the selected filename, after a cloned file commits", async () => {
    const onPrepared = vi.fn();
    const node = render({ onPrepared });
    const input = node.querySelector("#prep-input") as HTMLInputElement;
    const original = new File([JPEG_HEADER], "library.jpg", { type: "image/jpeg" });
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [original],
    });

    const change = act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(node.textContent).toMatch(/Preparing/i);
    await change;

    expect(onPrepared).toHaveBeenCalledTimes(1);
    expect(onPrepared.mock.calls[0][0][0]).not.toBe(original);
    expect(node.textContent).toMatch(/library\.jpg/);
    expect(node.textContent).not.toMatch(/Preparing/i);
  });

  it("puts the prepared File into the named form input only after clone commits", async () => {
    const node = render({ name: "file", required: true });
    const picker = node.querySelector("#prep-input") as HTMLInputElement;
    const named = node.querySelector('input[name="file"]') as HTMLInputElement;
    expect(named).toBeTruthy();
    expect(named).not.toBe(picker);

    const original = new File([PDF_HEADER], "card.pdf", { type: "application/pdf" });
    Object.defineProperty(picker, "files", {
      configurable: true,
      value: [original],
    });

    await act(async () => {
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(named.files).toHaveLength(1);
    expect(named.files?.[0]).not.toBe(original);
    expect(named.files?.[0]?.type).toBe("application/pdf");
    expect(picker.value).toBe("");
  });

  it("shows the safe unreadable copy and does not commit a named file on empty iOS picks", async () => {
    const onPrepared = vi.fn();
    const node = render({ name: "file", onPrepared });
    const picker = node.querySelector("#prep-input") as HTMLInputElement;
    const named = node.querySelector('input[name="file"]') as HTMLInputElement;
    Object.defineProperty(picker, "files", {
      configurable: true,
      value: [new File([], "empty.jpg", { type: "image/jpeg" })],
    });

    await act(async () => {
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onPrepared).not.toHaveBeenCalled();
    expect(named.files).toHaveLength(0);
    expect(node.textContent).toContain(UNREADABLE_PHOTO_MESSAGE);
  });

  it("clears and disables the committed file A while B prepares so submit cannot send A", async () => {
    const onPreparingChange = vi.fn();
    const onPrepared = vi.fn();
    const node = render({
      name: "file",
      required: true,
      onPrepared,
      onPreparingChange,
    });
    const picker = node.querySelector("#prep-input") as HTMLInputElement;
    const named = node.querySelector('input[name="file"]') as HTMLInputElement;
    const submit = node.querySelector('button[type="submit"]') as HTMLButtonElement;
    const form = node.querySelector("form") as HTMLFormElement;

    const fileA = new File([PDF_HEADER], "card-a.pdf", { type: "application/pdf" });
    Object.defineProperty(picker, "files", {
      configurable: true,
      value: [fileA],
    });
    await act(async () => {
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(named.files?.[0]?.name).toBe("card-a.pdf");
    expect(submit.disabled).toBe(false);

    const fileB = new File([PDF_HEADER], "card-b.pdf", { type: "application/pdf" });
    let releaseB!: (files: File[]) => void;
    vi.mocked(readPickedUploadFiles).mockImplementationOnce(
      () =>
        new Promise<File[]>((resolve) => {
          releaseB = resolve;
        })
    );
    Object.defineProperty(picker, "files", {
      configurable: true,
      value: [fileB],
    });

    const pendingB = act(async () => {
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onPreparingChange).toHaveBeenCalledWith(true);
    expect(named.disabled).toBe(true);
    expect(named.files).toHaveLength(0);
    expect(submit.disabled).toBe(true);
    expect(new FormData(form).get("file")).toBeNull();

    await act(async () => {
      releaseB([fileB]);
      await pendingB;
    });

    expect(onPreparingChange).toHaveBeenLastCalledWith(false);
    expect(named.disabled).toBe(false);
    expect(named.files?.[0]?.name).toBe("card-b.pdf");
    expect(submit.disabled).toBe(false);
    expect(onPrepared.mock.calls.at(-1)?.[0][0]?.name).toBe("card-b.pdf");
    expect(named.required).toBe(true);
  });
});
