/** @vitest-environment jsdom */
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { refresh, uploadCustomerDocumentAction } = vi.hoisted(() => ({
  refresh: vi.fn(),
  uploadCustomerDocumentAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("@/app/(app)/customers/document-actions", () => ({
  uploadCustomerDocumentAction,
  deleteCustomerDocumentAction: vi.fn(),
}));
vi.mock("@/components/forms/PreparedFileInput", () => ({
  PreparedFileInput: ({
    id,
    name,
    onPrepared,
  }: {
    id: string;
    name?: string;
    onPrepared?: (files: File[]) => void;
  }) =>
    createElement("input", {
      id,
      name,
      type: "file",
      onChange: (event: { currentTarget: HTMLInputElement }) => {
        const file = event.currentTarget.files?.[0];
        onPrepared?.(file ? [file] : []);
      },
    }),
}));

import { CustomerDocuments } from "@/components/customers/CustomerDocuments";

describe("CustomerDocuments successful upload reset", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    uploadCustomerDocumentAction.mockResolvedValue({ error: null });
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

  it("clears the prepared file so a new title cannot resubmit the old file", async () => {
    await act(async () => {
      root.render(
        createElement(CustomerDocuments, {
          customerId: "cust-1",
          documents: [],
          canUpload: true,
          canDelete: false,
        })
      );
    });

    const title = container.querySelector('input[type="text"]') as HTMLInputElement;
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const form = container.querySelector("form") as HTMLFormElement;
    const file = new File(["bytes"], "card.jpg", { type: "image/jpeg" });
    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [file],
    });

    await act(async () => {
      title.value = "Insurance card";
      title.dispatchEvent(new Event("input", { bubbles: true }));
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => {
      expect(uploadCustomerDocumentAction).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      title.value = "Another title";
      title.dispatchEvent(new Event("input", { bubbles: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(uploadCustomerDocumentAction).toHaveBeenCalledTimes(1);
    expect(container.textContent).toMatch(/Choose a file to upload/i);
  });
});
