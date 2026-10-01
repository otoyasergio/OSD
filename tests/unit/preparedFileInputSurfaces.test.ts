/** @vitest-environment jsdom */
import { createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readPickedUploadFiles } from "@/lib/forms/readPickedUploadFiles";

vi.mock("@/lib/forms/readPickedUploadFiles", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/forms/readPickedUploadFiles")>();
  return {
    ...actual,
    readPickedUploadFiles: vi.fn(actual.readPickedUploadFiles),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement("a", { href }, children),
}));

vi.mock("@/app/(app)/customers/document-actions", () => ({
  uploadCustomerDocumentAction: vi.fn(async () => ({ error: null })),
  deleteCustomerDocumentAction: vi.fn(async () => ({ error: null })),
}));

import { ProfilePhotoForm } from "@/components/forms/ProfilePhotoForm";

const PDF = new File([Uint8Array.from([0x25, 0x50, 0x44, 0x46])], "card-a.pdf", {
  type: "application/pdf",
});
const PDF_B = new File([Uint8Array.from([0x25, 0x50, 0x44, 0x46])], "card-b.pdf", {
  type: "application/pdf",
});

function mount(node: ReactNode): { container: HTMLDivElement; root: Root } {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(readPickedUploadFiles).mockImplementation(async (input) =>
    Array.from(input.files ?? [])
  );
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return { container, root };
}

async function pick(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function fileInputs(container: HTMLElement) {
  const named = container.querySelector('input[name="file"]') as HTMLInputElement;
  const picker = [...container.querySelectorAll("input[type='file']")].find(
    (node) => node !== named
  ) as HTMLInputElement;
  const form = named.closest("form") as HTMLFormElement;
  const submit = form.querySelector('button[type="submit"]') as HTMLButtonElement;
  return { named, picker, form, submit };
}

describe("ProfilePhotoForm preparing submit", () => {
  let mounted: { container: HTMLDivElement; root: Root } | null = null;
  afterEach(() => {
    if (!mounted) return;
    act(() => mounted?.root.unmount());
    mounted.container.remove();
    mounted = null;
  });

  it("disables submit and drops A from FormData while B prepares", async () => {
    mounted = mount(
      createElement(ProfilePhotoForm, {
        firstName: "Ada",
        lastName: "Owner",
        photoUrl: null,
        uploadAction: async () => ({ error: null, success: null, resetKey: 0 }),
        removeAction: async () => ({ error: null, success: null, resetKey: 0 }),
      })
    );
    const { named, picker, form, submit } = fileInputs(mounted.container);
    await pick(picker, PDF);
    expect(named.files?.[0]?.name).toBe("card-a.pdf");

    let releaseB!: (files: File[]) => void;
    vi.mocked(readPickedUploadFiles).mockImplementationOnce(
      () =>
        new Promise<File[]>((resolve) => {
          releaseB = resolve;
        })
    );
    const pendingB = pick(picker, PDF_B);
    expect(submit.disabled).toBe(true);
    expect(named.files).toHaveLength(0);
    expect(new FormData(form).get("file")).toBeNull();

    await act(async () => {
      releaseB([PDF_B]);
      await pendingB;
    });
    expect(submit.disabled).toBe(false);
    expect(named.files?.[0]?.name).toBe("card-b.pdf");
  });
});
