// @vitest-environment jsdom

import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { uploadAssistantPhotoAction, readPickedPhotoFiles } = vi.hoisted(() => ({
  uploadAssistantPhotoAction: vi.fn(),
  readPickedPhotoFiles: vi.fn(),
}));

vi.mock("@/app/(app)/work_orders/assistant-actions", () => ({
  uploadAssistantPhotoAction,
}));
vi.mock("@/lib/forms/readPickedPhotoFiles", () => ({ readPickedPhotoFiles }));

import { DiagnosticsPhotoPicker } from "@/components/diagnostics/DiagnosticsPhotoPicker";
import { PhotoUploadQueueProvider } from "@/components/photos/PhotoUploadQueueProvider";
import {
  createMemoryPhotoUploadQueueDatabase,
  MemoryPhotoUploadQueueStore,
} from "@/tests/helpers/memoryPhotoUploadQueueStore";
import {
  buildPhotosPayload,
  type DiagnosticsPhotoSelection,
  type DiagnosticsPhotoSourceRow,
} from "@/lib/diagnostics/photoSelection";

const WO = "41111111-1111-4111-8111-111111111111";
const THREAD = "71111111-1111-4111-8111-111111111111";
const JOB = "51111111-1111-4111-8111-111111111111";
const OTHER_JOB = "52222222-2222-4222-8222-222222222222";

function id(n: number): string {
  return `a${n}111111-1111-4111-8111-111111111111`;
}

function photo(
  n: number,
  overrides: Partial<DiagnosticsPhotoSourceRow> = {}
): DiagnosticsPhotoSourceRow {
  return {
    photo_id: id(n),
    work_order_id: WO,
    job_id: JOB,
    category: "job_work",
    created_at: "2026-09-29T14:05:00.000Z",
    thumb_url: `https://signed.example/thumb-${n}.jpg`,
    ...overrides,
  };
}

type HarnessProps = {
  photos?: DiagnosticsPhotoSourceRow[];
  jobId?: string | null;
  requestedPrompt?: string | null;
  requestKey?: string | null;
  canMutate?: boolean;
  preview?: boolean;
  readOnly?: boolean;
  disabled?: boolean;
  initialSelections?: DiagnosticsPhotoSelection[];
};

let testStore = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());

async function echoAssistantUpload(
  workOrderId: string,
  previous: {
    status: "idle" | "success" | "error";
    error: string | null;
    data?: unknown;
  },
  form: FormData
) {
  const result = await uploadAssistantPhotoAction(workOrderId, previous, form);
  if (result.status === "success" && result.data && typeof result.data === "object") {
    return {
      ...result,
      data: {
        ...result.data,
        clientUploadId: String(form.get("client_upload_id") ?? ""),
      },
    };
  }
  return result;
}

function Harness({
  photos = [],
  jobId = JOB,
  requestedPrompt = null,
  requestKey,
  canMutate = true,
  preview = false,
  readOnly = false,
  disabled = false,
  initialSelections = [],
}: HarnessProps) {
  const [selections, setSelections] = useState(initialSelections);
  return React.createElement(
    PhotoUploadQueueProvider,
    {
      userId: "user-a",
      locationId: "location-a",
      store: testStore,
      isOnline: () => true,
      uploadAssistantPhoto: echoAssistantUpload,
    },
    React.createElement(
      "div",
      null,
      React.createElement(DiagnosticsPhotoPicker, {
        thread: { threadId: THREAD, workOrderId: WO, jobId },
        photos,
        selections,
        onSelectionsChange: setSelections,
        requestedPrompt,
        requestKey: requestKey ?? (requestedPrompt ? "request-1" : null),
        canMutate,
        preview,
        readOnly,
        disabled,
      }),
      React.createElement(
        "button",
        {
          type: "button",
          "data-testid": "external-fill",
          onClick: () =>
            setSelections(
              [id(20), id(21), id(22)].map((photoId) => ({
                photoId,
                purpose: "external",
              }))
            ),
        },
        "fill"
      ),
      React.createElement(
        "output",
        { "data-testid": "payload" },
        JSON.stringify(buildPhotosPayload(selections))
      )
    )
  );
}

describe("DiagnosticsPhotoPicker", () => {
  let container: HTMLDivElement;
  let root: Root;
  let objectUrls = 0;
  const createObjectURL = vi.fn(() => `blob:local-${(objectUrls += 1)}`);
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    testStore = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    objectUrls = 0;
    URL.createObjectURL = createObjectURL as never;
    URL.revokeObjectURL = revokeObjectURL as never;
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  async function render(props: HarnessProps = {}) {
    await act(async () => {
      root.render(React.createElement(Harness, props));
    });
  }

  const payload = () =>
    JSON.parse(container.querySelector('[data-testid="payload"]')!.textContent ?? "null");
  const thumbButtons = () =>
    Array.from(container.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"));
  const purposeInputs = () =>
    Array.from(container.querySelectorAll<HTMLInputElement>('input[type="text"]'));
  const cameraInput = () =>
    container.querySelector<HTMLInputElement>('input[type="file"][capture]');
  const libraryInput = () =>
    container.querySelector<HTMLInputElement>('input[type="file"]:not([capture])');
  const labelByText = (text: string) =>
    Array.from(container.querySelectorAll<HTMLLabelElement>("label")).find(
      (label) => label.textContent?.trim() === text
    )!;
  const cameraButton = () => labelByText("Camera");
  const libraryButton = () => labelByText("Library");

  async function pick(input: HTMLInputElement, files: File[]) {
    Object.defineProperty(input, "files", { value: files, configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  async function click(el: Element) {
    await act(async () => {
      (el as HTMLElement).click();
    });
  }

  it("lists only eligible photos for this thread and never auto-selects", async () => {
    await render({
      photos: [
        photo(1),
        photo(2, { category: "vin", job_id: null }),
        photo(3, { category: "job_proof", job_id: OTHER_JOB }),
        photo(4, { category: "inspection_brakes", job_id: null }),
      ],
    });

    expect(thumbButtons()).toHaveLength(2);
    expect(thumbButtons().every((b) => b.getAttribute("aria-pressed") === "false")).toBe(
      true
    );
    expect(payload()).toEqual([]);
    expect(purposeInputs()).toHaveLength(0);
    const imgs = Array.from(container.querySelectorAll("img")).map((i) => i.src);
    expect(imgs).toEqual([
      "https://signed.example/thumb-1.jpg",
      "https://signed.example/thumb-4.jpg",
    ]);
  });

  it("discloses that only selected photos are analysed and findings need verification", async () => {
    await render({ photos: [photo(1)] });
    const text = container.textContent ?? "";
    expect(text).toMatch(/only the photos you select/i);
    expect(text).toMatch(/visible/i);
    expect(text).toMatch(/technician verification|verify/i);
  });

  it("selects on tap with the requested prompt as the editable default purpose", async () => {
    await render({ photos: [photo(1)], requestedPrompt: "Show the left caliper" });

    await click(thumbButtons()[0]);

    expect(thumbButtons()[0].getAttribute("aria-pressed")).toBe("true");
    expect(purposeInputs()).toHaveLength(1);
    expect(purposeInputs()[0].value).toBe("Show the left caliper");
    expect(payload()).toEqual([{ photoId: id(1), purpose: "Show the left caliper" }]);

    await act(async () => {
      const input = purposeInputs()[0];
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )!.set!;
      setter.call(input, "Pad thickness");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(payload()).toEqual([{ photoId: id(1), purpose: "Pad thickness" }]);
    expect(purposeInputs()[0].maxLength).toBe(500);
  });

  it("removes a selection", async () => {
    await render({ photos: [photo(1)] });
    await click(thumbButtons()[0]);
    const remove = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Remove"]'
    )!;
    await click(remove);
    expect(payload()).toEqual([]);
    expect(thumbButtons()[0].getAttribute("aria-pressed")).toBe("false");
  });

  it("caps at three selections and disables the remaining photos and uploads", async () => {
    await render({ photos: [photo(1), photo(2), photo(3), photo(4)] });
    for (const button of thumbButtons().slice(0, 3)) await click(button);

    expect(payload()).toHaveLength(3);
    expect(thumbButtons()[3].disabled).toBe(true);
    expect(cameraInput()!.disabled).toBe(true);
    expect(libraryInput()!.disabled).toBe(true);
    expect(cameraButton().getAttribute("aria-disabled")).toBe("true");
    expect(libraryButton().getAttribute("aria-disabled")).toBe("true");
    expect(container.textContent).toMatch(/3 of 3/);
  });

  it("uploads a camera capture as a new selected photo with a local preview", async () => {
    const file = new File(["jpeg"], "cap.jpg", { type: "image/jpeg" });
    readPickedPhotoFiles.mockResolvedValue([file]);
    uploadAssistantPhotoAction.mockResolvedValue({
      status: "success",
      error: null,
      data: {
        photoId: id(9),
        workOrderId: WO,
        jobId: JOB,
        category: "job_work",
        notes: "Show the left caliper",
        createdAt: "2026-09-29T15:00:00.000Z",
      },
    });
    await render({ requestedPrompt: "Show the left caliper" });
    const input = cameraInput()!;
    expect(input.getAttribute("capture")).toBe("environment");

    await pick(input, [file]);

    expect(readPickedPhotoFiles).toHaveBeenCalledWith(input);
    expect(uploadAssistantPhotoAction).toHaveBeenCalledTimes(1);
    const [workOrderId, , form] = uploadAssistantPhotoAction.mock.calls[0] as [
      string,
      unknown,
      FormData,
    ];
    expect(workOrderId).toBe(WO);
    expect(form.get("thread_id")).toBe(THREAD);
    expect(form.get("purpose")).toBe("Show the left caliper");
    expect(form.get("file")).toBeInstanceOf(File);
    expect(form.has("category")).toBe(false);
    expect(form.has("job_id")).toBe(false);

    await vi.waitFor(() => {
      expect(payload()).toEqual([{ photoId: id(9), purpose: "Show the left caliper" }]);
    });
    expect(createObjectURL).toHaveBeenCalled();
    const preview = container.querySelector<HTMLImageElement>('img[src^="blob:"]');
    expect(preview).not.toBeNull();
    expect(thumbButtons()[0].getAttribute("aria-pressed")).toBe("true");
  });

  it("uploads from the library input and only as many files as free slots", async () => {
    const files = [1, 2, 3].map(
      (n) => new File([String(n)], `f${n}.jpg`, { type: "image/jpeg" })
    );
    readPickedPhotoFiles.mockResolvedValue(files);
    let n = 0;
    uploadAssistantPhotoAction.mockImplementation(async () => ({
      status: "success",
      error: null,
      data: {
        photoId: id((n += 1) + 5),
        workOrderId: WO,
        jobId: JOB,
        category: "job_work",
        notes: null,
        createdAt: "2026-09-29T15:00:00.000Z",
      },
    }));
    await render({
      photos: [photo(1)],
      initialSelections: [{ photoId: id(1), purpose: "a" }],
    });

    await pick(libraryInput()!, files);

    await vi.waitFor(() => {
      expect(uploadAssistantPhotoAction).toHaveBeenCalledTimes(2);
      expect(payload()).toHaveLength(3);
    });
    expect(container.textContent).toMatch(/only 3 photos/i);
  });

  it("shows the server error and selects nothing when upload fails", async () => {
    const file = new File(["x"], "x.jpg", { type: "image/jpeg" });
    readPickedPhotoFiles.mockResolvedValue([file]);
    uploadAssistantPhotoAction.mockResolvedValue({
      status: "error",
      error: "That photo is too large.",
    });
    await render();

    await pick(cameraInput()!, [file]);

    await vi.waitFor(() => {
      expect(uploadAssistantPhotoAction).toHaveBeenCalledTimes(1);
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "That photo is too large."
      );
    });
    expect(payload()).toEqual([]);
  });

  it("retries transient upload failures with the shared retry helper", async () => {
    vi.useFakeTimers();
    const file = new File(["x"], "x.jpg", { type: "image/jpeg" });
    readPickedPhotoFiles.mockResolvedValue([file]);
    uploadAssistantPhotoAction
      .mockResolvedValueOnce({ status: "error", error: "Failed to fetch" })
      .mockResolvedValueOnce({
        status: "success",
        error: null,
        data: {
          photoId: id(8),
          workOrderId: WO,
          jobId: JOB,
          category: "job_work",
          notes: null,
          createdAt: "2026-09-29T15:00:00.000Z",
        },
      });
    await render();
    const input = cameraInput()!;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(uploadAssistantPhotoAction).toHaveBeenCalledTimes(2);
    expect(payload()).toEqual([{ photoId: id(8), purpose: "Work photo for analysis" }]);
  });

  it("shows an actionable message and no upload controls for a work-order-only thread", async () => {
    await render({
      jobId: null,
      photos: [
        photo(1, { category: "job_work" }),
        photo(2, { category: "inspection_tires", job_id: null }),
      ],
    });

    expect(cameraInput()).toBeNull();
    expect(libraryInput()).toBeNull();
    expect(container.textContent).toMatch(/open ask otomoto from a job/i);
    expect(thumbButtons()).toHaveLength(1);
    expect(uploadAssistantPhotoAction).not.toHaveBeenCalled();
  });

  it.each([
    ["readOnly", { readOnly: true }],
    ["preview", { preview: true }],
    ["canMutate=false", { canMutate: false }],
    ["disabled (pending/archived)", { disabled: true }],
  ])("is inert when %s", async (_name, flags) => {
    await render({ photos: [photo(1)], ...flags });
    expect(thumbButtons().every((b) => b.disabled)).toBe(true);
    expect(cameraButton().getAttribute("aria-disabled")).toBe("true");
    expect(libraryButton().getAttribute("aria-disabled")).toBe("true");
    expect(cameraInput()!.disabled).toBe(true);
    expect(libraryInput()!.disabled).toBe(true);

    const file = new File(["x"], "x.jpg", { type: "image/jpeg" });
    await pick(cameraInput()!, [file]);
    expect(readPickedPhotoFiles).not.toHaveBeenCalled();
    expect(uploadAssistantPhotoAction).not.toHaveBeenCalled();
  });

  it("revokes local preview object URLs when unmounted", async () => {
    const file = new File(["x"], "x.jpg", { type: "image/jpeg" });
    readPickedPhotoFiles.mockResolvedValue([file]);
    uploadAssistantPhotoAction.mockResolvedValue({
      status: "success",
      error: null,
      data: {
        photoId: id(7),
        workOrderId: WO,
        jobId: JOB,
        category: "job_work",
        notes: null,
        createdAt: "2026-09-29T15:00:00.000Z",
      },
    });
    await render();
    await pick(cameraInput()!, [file]);
    await vi.waitFor(() => {
      expect(payload()).toEqual([{ photoId: id(7), purpose: "Work photo for analysis" }]);
    });
    expect(createObjectURL).toHaveBeenCalled();

    await act(async () => root.unmount());
    expect(revokeObjectURL).toHaveBeenCalled();
    root = createRoot(container);
  });

  it("moves focus to the picker when the assistant requests a photo", async () => {
    await render({ photos: [photo(1)], requestedPrompt: "Show the left caliper" });
    const region = container.querySelector('[role="group"]');
    expect(region?.getAttribute("aria-label") ?? region?.textContent).toMatch(/photo/i);
    expect(document.activeElement).toBe(region);
    expect(container.textContent).toContain("Show the left caliper");
  });

  it("does not steal focus without a photo request", async () => {
    await render({ photos: [photo(1)] });
    expect(document.activeElement).toBe(document.body);
  });

  it("uses native Camera and Library labels instead of programmatic click()", async () => {
    await render();
    for (const [button, input] of [
      [cameraButton(), cameraInput()!],
      [libraryButton(), libraryInput()!],
    ] as const) {
      expect(button.tagName).toBe("LABEL");
      expect(button.htmlFor).toBe(input.id);
      expect(button.getAttribute("aria-disabled")).toBe("false");
      expect(input.tabIndex).toBe(-1);
      expect(input.getAttribute("aria-hidden")).toBe("true");
    }
    expect(cameraInput()!.getAttribute("capture")).toBe("environment");
    expect(libraryInput()!.hasAttribute("capture")).toBe(false);
    expect(container.textContent).toMatch(/saved to this device/i);
  });

  it("focuses the picker only when a new photo request first arrives", async () => {
    await render({
      photos: [photo(1)],
      requestedPrompt: "Show the caliper",
      requestKey: "m1",
    });
    const region = container.querySelector<HTMLElement>('[role="group"]')!;
    expect(document.activeElement).toBe(region);

    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();

    // Toggling interactive (e.g. pending/error) must not steal focus back.
    await render({
      photos: [photo(1)],
      requestedPrompt: "Show the caliper",
      requestKey: "m1",
      disabled: true,
    });
    await render({
      photos: [photo(1)],
      requestedPrompt: "Show the caliper",
      requestKey: "m1",
    });
    expect(document.activeElement).toBe(outside);

    // The same prompt on a later assistant message is a new request.
    await render({
      photos: [photo(1)],
      requestedPrompt: "Show the caliper",
      requestKey: "m2",
    });
    expect(document.activeElement).toBe(region);
    outside.remove();
  });

  it("does not focus when the request first arrives while inert", async () => {
    await render({
      photos: [photo(1)],
      requestedPrompt: "Show the caliper",
      requestKey: "m1",
      disabled: true,
    });
    await render({
      photos: [photo(1)],
      requestedPrompt: "Show the caliper",
      requestKey: "m1",
    });
    expect(document.activeElement).toBe(document.body);
  });

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  const uploaded = (n: number, extra: Record<string, unknown> = {}) => ({
    status: "success",
    error: null,
    data: {
      photoId: id(n),
      workOrderId: WO,
      jobId: JOB,
      category: "job_work",
      notes: null,
      createdAt: "2026-09-29T15:00:00.000Z",
      ...extra,
    },
  });

  it("locks selection changes while an upload is pending", async () => {
    const gate = deferred<unknown>();
    const file = new File(["x"], "x.jpg", { type: "image/jpeg" });
    readPickedPhotoFiles.mockResolvedValue([file]);
    uploadAssistantPhotoAction.mockReturnValue(gate.promise);
    await render({
      photos: [photo(1), photo(2)],
      initialSelections: [{ photoId: id(1), purpose: "a" }],
    });

    await pick(cameraInput()!, [file]);

    expect(container.textContent).toContain("Uploading photo");
    expect(thumbButtons().every((b) => b.disabled)).toBe(true);
    expect(purposeInputs().every((i) => i.disabled)).toBe(true);
    expect(
      Array.from(
        container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Remove"]')
      ).every((b) => b.disabled)
    ).toBe(true);
    expect(cameraButton().getAttribute("aria-disabled")).toBe("true");
    expect(libraryButton().getAttribute("aria-disabled")).toBe("true");

    await act(async () => gate.resolve(uploaded(9)));

    expect(payload().map((p: { photoId: string }) => p.photoId)).toEqual([id(1), id(9)]);
    expect(thumbButtons().some((b) => b.disabled)).toBe(false);
  });

  it("announces when an upload is stored but the selection filled up meanwhile, and keeps it selectable", async () => {
    const gate = deferred<unknown>();
    const file = new File(["x"], "x.jpg", { type: "image/jpeg" });
    readPickedPhotoFiles.mockResolvedValue([file]);
    uploadAssistantPhotoAction.mockReturnValue(gate.promise);
    await render();
    await pick(cameraInput()!, [file]);

    await click(container.querySelector('[data-testid="external-fill"]')!);
    expect(payload()).toHaveLength(3);
    await act(async () => gate.resolve(uploaded(9)));

    expect(payload().map((p: { photoId: string }) => p.photoId)).not.toContain(id(9));
    const notice = Array.from(container.querySelectorAll('[role="status"]')).find((el) =>
      /saved.*not selected|already 3 selected/i.test(el.textContent ?? "")
    );
    expect(notice).toBeTruthy();
    const newThumb = thumbButtons().find((b) => b.querySelector('img[src^="blob:"]'));
    expect(newThumb).toBeTruthy();
    expect(newThumb!.getAttribute("aria-pressed")).toBe("false");

    // Free a slot, then select the stored photo.
    await click(
      container.querySelector<HTMLButtonElement>('button[aria-label^="Remove photo 1"]')!
    );
    await click(newThumb!);
    expect(payload().map((p: { photoId: string }) => p.photoId)).toContain(id(9));
  });

  it("stops uploading remaining files once capacity is gone", async () => {
    const gate = deferred<unknown>();
    const files = [1, 2].map(
      (n) => new File([String(n)], `f${n}.jpg`, { type: "image/jpeg" })
    );
    readPickedPhotoFiles.mockResolvedValue(files);
    uploadAssistantPhotoAction
      .mockReturnValueOnce(gate.promise)
      .mockResolvedValue(uploaded(10));
    await render();
    await pick(libraryInput()!, files);
    await click(container.querySelector('[data-testid="external-fill"]')!);
    await act(async () => gate.resolve(uploaded(9)));

    expect(uploadAssistantPhotoAction).toHaveBeenCalledTimes(1);
  });

  it("selects a saved confirmation even when the server payload category is unexpected", async () => {
    const file = new File(["x"], "x.jpg", { type: "image/jpeg" });
    readPickedPhotoFiles.mockResolvedValue([file]);
    uploadAssistantPhotoAction.mockResolvedValue(uploaded(9, { category: "vin" }));
    await render();
    await pick(cameraInput()!, [file]);

    await vi.waitFor(() => {
      expect(payload()).toEqual([{ photoId: id(9), purpose: "Work photo for analysis" }]);
    });
  });

  it("revokes the local preview URL when a local photo is deselected and recreates it on reselect", async () => {
    const file = new File(["x"], "x.jpg", { type: "image/jpeg" });
    readPickedPhotoFiles.mockResolvedValue([file]);
    uploadAssistantPhotoAction.mockResolvedValue(uploaded(9));
    await render();
    await pick(cameraInput()!, [file]);
    await vi.waitFor(() => {
      expect(payload()).toHaveLength(1);
    });
    const preview = container.querySelector<HTMLImageElement>('img[src^="blob:"]');
    expect(preview).not.toBeNull();
    const src = preview!.src;

    await click(thumbButtons()[0]);
    expect(revokeObjectURL).toHaveBeenCalledWith(src);
    expect(container.querySelector('img[src^="blob:"]')).toBeNull();

    await click(thumbButtons()[0]);
    expect(container.querySelector('img[src^="blob:"]')).not.toBeNull();
  });

  it("revokes the local preview once the server list supplies its own thumbnail", async () => {
    const file = new File(["x"], "x.jpg", { type: "image/jpeg" });
    readPickedPhotoFiles.mockResolvedValue([file]);
    uploadAssistantPhotoAction.mockResolvedValue(uploaded(9));
    await render();
    await pick(cameraInput()!, [file]);
    await vi.waitFor(() => {
      expect(payload()).toHaveLength(1);
    });

    await render({
      photos: [photo(9, { thumb_url: "https://signed.example/server-9.jpg" })],
      initialSelections: [{ photoId: id(9), purpose: "Work photo for analysis" }],
    });

    expect(revokeObjectURL).toHaveBeenCalled();
    expect(
      container.querySelector('img[src="https://signed.example/server-9.jpg"]')
    ).not.toBeNull();
  });

  it("collapses newline/tab whitespace in the displayed prompt and the default purpose", async () => {
    const file = new File(["x"], "x.jpg", { type: "image/jpeg" });
    readPickedPhotoFiles.mockResolvedValue([file]);
    uploadAssistantPhotoAction.mockResolvedValue(uploaded(9));
    await render({
      photos: [photo(1)],
      requestedPrompt: "  Show the\n left\tcaliper \r\n piston ",
    });
    expect(container.textContent).toContain(
      "Photo requested: Show the left caliper piston"
    );

    await click(thumbButtons()[0]);
    expect(purposeInputs()[0].value).toBe("Show the left caliper piston");

    await pick(cameraInput()!, [file]);
    const form = uploadAssistantPhotoAction.mock.calls[0][2] as FormData;
    expect(form.get("purpose")).toBe("Show the left caliper piston");
  });
});
