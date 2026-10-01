/** @vitest-environment jsdom */
import { createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PhotoUploadQueueProvider } from "@/components/photos/PhotoUploadQueueProvider";
import { IntakePhotoSlots } from "@/components/forms/IntakePhotoSlots";
import { OptionalIntakePhotos } from "@/components/forms/OptionalIntakePhotos";
import {
  attachAndWaitForRequiredIntakePhotos,
  filesFromQueuedIntakeItems,
} from "@/lib/photos/intakeQueue";
import { PhotoQueuePersistenceError } from "@/lib/photos/uploadQueue/errors";
import {
  createMemoryPhotoUploadQueueDatabase,
  MemoryPhotoUploadQueueStore,
} from "@/tests/helpers/memoryPhotoUploadQueueStore";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REQUIRED = ["front", "rear", "left_side", "right_side", "vin", "odometer"] as const;

describe("intake photo queue helpers", () => {
  it("rebuilds intake files from queued draft items", async () => {
    const blob = new Blob(["front-bytes"], { type: "image/jpeg" });
    const files = filesFromQueuedIntakeItems([
      {
        queueId: "q1",
        clientUploadId: "c1",
        userId: "user-a",
        locationId: "location-a",
        intakeDraftId: "draft-1",
        category: "front",
        blob,
        fileName: "front.jpg",
        mimeType: "image/jpeg",
        lastModified: 9,
        byteCount: 11,
        status: "queued",
        attemptCount: 0,
        retryAt: null,
        lastError: null,
        createdAt: 1,
        updatedAt: 1,
        leaseOwner: null,
        leaseExpiresAt: null,
        uploadSlotOwner: null,
        uploadSlotExpiresAt: null,
      },
    ]);
    expect(files.front).toBeInstanceOf(File);
    expect(files.front?.name).toBe("front.jpg");
    expect(
      await files.front?.arrayBuffer().then((b) => new TextDecoder().decode(b))
    ).toBe("front-bytes");
  });

  it("waits for required confirmations and treats any failure as blocking", async () => {
    const failed = { queueId: "vin", category: "vin", status: "failed" };
    const queue = {
      attachDraftToWorkOrder: vi.fn(async () =>
        REQUIRED.map((category) => ({ queueId: category }))
      ),
      waitForConfirmations: vi.fn(async () => ({
        ok: false as const,
        failed: [failed],
      })),
    };
    const result = await attachAndWaitForRequiredIntakePhotos({
      queue: queue as never,
      intakeDraftId: "draft-1",
      workOrderId: "wo-1",
      requiredQueueIds: [...REQUIRED],
    });
    expect(queue.attachDraftToWorkOrder).toHaveBeenCalledWith("draft-1", "wo-1");
    expect(result).toEqual({ ok: false, failedCategories: ["vin"] });
  });
});

describe("IntakePhotoSlots queue commit", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:intake") as never;
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

  it("commits a picked photo to the queue before showing Ready", async () => {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    const onChange = vi.fn();
    function Harness() {
      const [value, setValue] = useState<Record<string, File | null>>({});
      return createElement(IntakePhotoSlots, {
        value,
        htmlRequired: false,
        intakeDraftId: "draft-1",
        onChange: (next) => {
          onChange(next);
          setValue(next);
        },
      });
    }
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
          createElement(Harness)
        )
      );
    });

    const input = container.querySelector(
      'input[aria-label="Front photo library"]'
    ) as HTMLInputElement;
    const original = new File(["tiny-jpeg-bytes"], "library.jpg", { type: "image/jpeg" });
    Object.defineProperty(input, "files", { configurable: true, value: [original] });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(container.textContent).toMatch(/Ready/);
    const listed = await store.list({ userId: "user-a", locationId: "location-a" });
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      category: "front",
      intakeDraftId: "draft-1",
      status: "queued",
    });
    expect(listed[0].clientUploadId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it("does not show Ready when the queue cannot persist the photo", async () => {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    store.replaceDraftCategory = async () => {
      throw new PhotoQueuePersistenceError(
        "quota_exceeded",
        "This device does not have enough storage to queue the photo."
      );
    };
    const onChange = vi.fn();
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
          createElement(IntakePhotoSlots, {
            value: {},
            onChange,
            htmlRequired: false,
            intakeDraftId: "draft-1",
          })
        )
      );
    });

    const input = container.querySelector(
      'input[aria-label="Front photo library"]'
    ) as HTMLInputElement;
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["x"], "front.jpg", { type: "image/jpeg" })],
    });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await vi.waitFor(() => {
      expect(container.textContent).toMatch(
        /not saved|enough storage|could not be saved/i
      );
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(container.textContent).not.toMatch(/Ready/);
  });
});

describe("OptionalIntakePhotos queue commit", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:extra") as never;
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

  it("queues extras without blocking required intake", async () => {
    function Harness() {
      const [files, setFiles] = useState<File[]>([]);
      return createElement(OptionalIntakePhotos, {
        value: files,
        onChange: setFiles,
        intakeDraftId: "draft-1",
      });
    }
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
          createElement(Harness)
        )
      );
    });

    const input = container.querySelector(
      'input[aria-label="Extra photos library"]'
    ) as HTMLInputElement;
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["extra"], "extra.jpg", { type: "image/jpeg" })],
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
    ).toMatchObject({ category: "other", intakeDraftId: "draft-1" });
  });
});

describe("intake surfaces no longer post photo bytes directly", () => {
  it.each([
    "components/forms/CreateWorkOrderForm.tsx",
    "components/forms/IntakePhotoRecoveryForm.tsx",
  ])(
    "%s attaches or waits through the queue instead of uploadSelectedIntakePhoto",
    (path) => {
      const source = readFileSync(join(process.cwd(), path), "utf8");
      expect(source).toMatch(/attachAndWaitForRequiredIntakePhotos|waitForConfirmations/);
      expect(source).not.toMatch(/uploadSelectedIntakePhoto/);
      expect(source).not.toMatch(/mapWithConcurrency/);
    }
  );
});
