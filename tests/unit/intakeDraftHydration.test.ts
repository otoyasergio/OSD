/** @vitest-environment jsdom */
import { createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { IntakePhotoSlots } from "@/components/forms/IntakePhotoSlots";
import { useIntakeDraftHydration } from "@/components/forms/useIntakeDraftHydration";
import { PhotoUploadQueueProvider } from "@/components/photos/PhotoUploadQueueProvider";
import { INTAKE_DRAFT_HYDRATING_COPY } from "@/lib/photos/intakeQueue";
import {
  createMemoryPhotoUploadQueueDatabase,
  MemoryPhotoUploadQueueStore,
} from "@/tests/helpers/memoryPhotoUploadQueueStore";

const SCOPE = { userId: "user-a", locationId: "location-a" };

describe("intake draft hydration source", () => {
  it("gates CreateWorkOrderForm picks on draft hydration", () => {
    const source = readFileSync(
      join(process.cwd(), "components/forms/CreateWorkOrderForm.tsx"),
      "utf8"
    );
    expect(source).toMatch(/useIntakeDraftHydration/);
    expect(source).toMatch(/INTAKE_DRAFT_HYDRATING_COPY|hydrating/);
    expect(source).toMatch(/shouldApplyCreateIntakePhotoChange/);
    expect(source).toMatch(/shouldApplyCreateOptionalPhotoChange/);
    expect(source).not.toMatch(/hydratedDraftRef/);
    expect(source).not.toMatch(/if \(stepId !== "photos"\) return;/);
  });

  it("hydrates from findNewestIncompleteIntakeDraft without depending on the queue identity", () => {
    const source = readFileSync(
      join(process.cwd(), "components/forms/useIntakeDraftHydration.ts"),
      "utf8"
    );
    expect(source).toMatch(/\[queue\.findNewestIncompleteIntakeDraft\]/);
    expect(source).not.toMatch(/}, \[queue\]\);/);
  });
});

describe("delayed intake draft hydration", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:hydrate") as never;
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

  it("keeps a later pick on the adopted draft after delayed Safari-style hydration", async () => {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    await store.put(SCOPE, {
      queueId: "restored-front",
      clientUploadId: "client-restored",
      userId: SCOPE.userId,
      locationId: SCOPE.locationId,
      intakeDraftId: "adopted-draft",
      category: "rear",
      blob: new Blob(["rear-bytes"], { type: "image/jpeg" }),
      fileName: "rear.jpg",
      mimeType: "image/jpeg",
      lastModified: 9,
      byteCount: 10,
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
    });

    let releaseHydration!: () => void;
    const hydrationHold = new Promise<void>((resolve) => {
      releaseHydration = resolve;
    });
    const originalFind = store.list.bind(store);
    store.list = async (scope) => {
      await hydrationHold;
      return originalFind(scope);
    };

    function Harness() {
      const hydration = useIntakeDraftHydration();
      const [value, setValue] = useState<Record<string, File | null>>({});
      return createElement(
        "div",
        null,
        hydration.hydrating
          ? createElement("p", { role: "status" }, INTAKE_DRAFT_HYDRATING_COPY)
          : null,
        createElement(IntakePhotoSlots, {
          value,
          htmlRequired: false,
          intakeDraftId: hydration.intakeDraftId,
          disabled: hydration.hydrating,
          onChange: (next) => {
            hydration.markPicksBegun();
            setValue(next);
          },
        })
      );
    }

    await act(async () => {
      root.render(
        createElement(
          PhotoUploadQueueProvider,
          {
            userId: SCOPE.userId,
            locationId: SCOPE.locationId,
            store,
            isOnline: () => false,
          },
          createElement(Harness)
        )
      );
    });

    expect(container.textContent).toMatch(/Restoring saved photos/i);
    const inputWhileHydrating = container.querySelector(
      'input[aria-label="Front photo library"]'
    ) as HTMLInputElement | null;
    expect(inputWhileHydrating?.disabled || container.textContent).toBeTruthy();
    const addFront = container.querySelector(
      'button[aria-label="Add Front photo"]'
    ) as HTMLButtonElement | null;
    expect(addFront?.disabled).toBe(true);

    await act(async () => {
      releaseHydration();
    });
    await vi.waitFor(() => {
      expect(container.textContent).not.toMatch(/Restoring saved photos/i);
    });

    const input = container.querySelector(
      'input[aria-label="Front photo library"]'
    ) as HTMLInputElement;
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["front-bytes"], "front.jpg", { type: "image/jpeg" })],
    });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await vi.waitFor(async () => {
      const listed = await originalFind(SCOPE);
      expect(listed.some((item) => item.category === "front")).toBe(true);
    });
    const listed = await originalFind(SCOPE);
    const front = listed.find((item) => item.category === "front")!;
    expect(front.intakeDraftId).toBe("adopted-draft");
    expect(listed.some((item) => item.intakeDraftId === "adopted-draft")).toBe(true);
  });

  it("does not re-enter hydrating after queue item notifications", async () => {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    await store.put(SCOPE, {
      queueId: "restored-rear",
      clientUploadId: "client-restored",
      userId: SCOPE.userId,
      locationId: SCOPE.locationId,
      intakeDraftId: "adopted-draft",
      category: "rear",
      blob: new Blob(["rear-bytes"], { type: "image/jpeg" }),
      fileName: "rear.jpg",
      mimeType: "image/jpeg",
      lastModified: 9,
      byteCount: 10,
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
    });

    function Harness() {
      const hydration = useIntakeDraftHydration();
      const [value, setValue] = useState<Record<string, File | null>>({});
      return createElement(
        "div",
        null,
        hydration.hydrating
          ? createElement("p", { role: "status" }, INTAKE_DRAFT_HYDRATING_COPY)
          : null,
        createElement(IntakePhotoSlots, {
          value,
          htmlRequired: false,
          intakeDraftId: hydration.intakeDraftId,
          disabled: hydration.hydrating,
          onChange: (next) => {
            hydration.markPicksBegun();
            setValue(next);
          },
        })
      );
    }

    await act(async () => {
      root.render(
        createElement(
          PhotoUploadQueueProvider,
          {
            userId: SCOPE.userId,
            locationId: SCOPE.locationId,
            store,
            isOnline: () => false,
          },
          createElement(Harness)
        )
      );
    });

    await vi.waitFor(() => {
      expect(container.textContent).not.toMatch(/Restoring saved photos/i);
    });

    const input = container.querySelector(
      'input[aria-label="Front photo library"]'
    ) as HTMLInputElement;
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["front-bytes"], "front.jpg", { type: "image/jpeg" })],
    });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await vi.waitFor(async () => {
      const listed = await store.list(SCOPE);
      expect(listed.some((item) => item.category === "front")).toBe(true);
    });
    expect(container.textContent).not.toMatch(/Restoring saved photos/i);
  });
});
