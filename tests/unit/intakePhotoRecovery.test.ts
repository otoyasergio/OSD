/** @vitest-environment jsdom */
import { createElement, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntakePhotoRecoveryForm } from "@/components/forms/IntakePhotoRecoveryForm";
import {
  PhotoUploadQueueProvider,
  usePhotoUploadQueue,
  type PhotoUploadQueueApi,
} from "@/components/photos/PhotoUploadQueueProvider";
import {
  intakeContractHref,
  requiredQueueIdsForRemainingCategories,
} from "@/lib/photos/intakeQueue";
import {
  createMemoryPhotoUploadQueueDatabase,
  MemoryPhotoUploadQueueStore,
} from "@/tests/helpers/memoryPhotoUploadQueueStore";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh, replace: vi.fn(), prefetch: vi.fn() }),
}));

const SCOPE = { userId: "user-a", locationId: "location-a" };
const PHOTO_ID = "71111111-1111-4111-8111-111111111111";

function photoFile(name: string, bytes = "jpeg-bytes"): File {
  return new File([bytes], name, { type: "image/jpeg", lastModified: 1_700 });
}

function QueueProbe({
  onReady,
}: {
  onReady: (api: PhotoUploadQueueApi) => void;
}): ReactNode {
  const api = usePhotoUploadQueue();
  useEffect(() => {
    onReady(api);
  }, [api, onReady]);
  return null;
}

describe("requiredQueueIdsForRemainingCategories", () => {
  it("prefers enqueue ids, then scoped items, then durable receipts", () => {
    const built = requiredQueueIdsForRemainingCategories({
      remaining: ["vin", "odometer", "front"],
      workOrderId: "wo-1",
      preferredByCategory: { vin: "enqueued-vin" },
      items: [
        {
          queueId: "enqueued-vin",
          category: "vin",
          workOrderId: "wo-1",
        },
        {
          queueId: "item-odo",
          category: "odometer",
          workOrderId: "wo-1",
        },
        {
          queueId: "item-other-wo",
          category: "front",
          workOrderId: "wo-other",
        },
      ],
      receipts: [
        {
          queueId: "receipt-front",
          category: "front",
          workOrderId: "wo-1",
        },
        {
          queueId: "receipt-vin-ignored",
          category: "vin",
          workOrderId: "wo-1",
        },
      ],
    });
    expect(built).toEqual({
      queueIds: ["enqueued-vin", "item-odo", "receipt-front"],
      missingCategories: [],
    });
  });

  it("requires one id per remaining category", () => {
    const built = requiredQueueIdsForRemainingCategories({
      remaining: ["vin", "odometer"],
      workOrderId: "wo-1",
      items: [{ queueId: "item-vin", category: "vin", workOrderId: "wo-1" }],
      receipts: [],
    });
    expect(built).toEqual({
      queueIds: ["item-vin"],
      missingCategories: ["odometer"],
    });
  });

  it("ignores preferred ids that are no longer in scoped items or receipts", () => {
    const built = requiredQueueIdsForRemainingCategories({
      remaining: ["vin", "odometer"],
      workOrderId: "wo-1",
      preferredByCategory: { vin: "removed-vin", odometer: "receipt-odo" },
      items: [
        {
          queueId: "replacement-vin",
          category: "vin",
          workOrderId: "wo-1",
        },
      ],
      receipts: [
        {
          queueId: "receipt-odo",
          category: "odometer",
          workOrderId: "wo-1",
        },
      ],
    });
    expect(built).toEqual({
      queueIds: ["replacement-vin", "receipt-odo"],
      missingCategories: [],
    });
  });
});

describe("IntakePhotoRecoveryForm confirmation-before-submit", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    URL.createObjectURL = vi.fn(() => "blob:recovery") as never;
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

  it("navigates to the contract only after every remaining category is confirmed", async () => {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    let finishOdometer:
      | ((value: {
          error: string | null;
          photoId?: string;
          clientUploadId?: string;
        }) => void)
      | null = null;
    const odometerGate = new Promise<{
      error: string | null;
      photoId?: string;
      clientUploadId?: string;
    }>((resolve) => {
      finishOdometer = resolve;
    });

    await act(async () => {
      root.render(
        createElement(
          PhotoUploadQueueProvider,
          {
            userId: SCOPE.userId,
            locationId: SCOPE.locationId,
            store,
            uploadIntakePhoto: async (_id, _prev, form) => {
              const category = String(form.get("category"));
              const clientUploadId = String(form.get("client_upload_id"));
              if (category === "odometer") {
                return odometerGate.then((result) => ({
                  ...result,
                  clientUploadId: result.clientUploadId ?? clientUploadId,
                }));
              }
              return { error: null, photoId: `${PHOTO_ID}-vin`, clientUploadId };
            },
          },
          createElement(IntakePhotoRecoveryForm, {
            workOrderId: "wo-1",
            workOrderNumber: "WO-1",
            missingCategories: ["vin", "odometer"],
          })
        )
      );
    });

    async function pick(label: string, file: File) {
      const input = container.querySelector(
        `input[aria-label="${label}"]`
      ) as HTMLInputElement;
      Object.defineProperty(input, "files", { configurable: true, value: [file] });
      await act(async () => {
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }

    await pick("VIN photo library", photoFile("vin.jpg"));
    await pick(
      "Dash / odometer (bike on, mileage showing) photo library",
      photoFile("odo.jpg")
    );
    await vi.waitFor(async () => {
      const receipts = await store.listConfirmations(SCOPE);
      expect(receipts.some((receipt) => receipt.category === "vin")).toBe(true);
    });
    expect(push).not.toHaveBeenCalled();

    const submit = Array.from(container.querySelectorAll("button")).find((button) =>
      /continue|upload remaining photos/i.test(button.textContent ?? "")
    ) as HTMLButtonElement;
    await act(async () => {
      submit.click();
    });
    expect(push).not.toHaveBeenCalled();

    await act(async () => {
      finishOdometer?.({
        error: null,
        photoId: `${PHOTO_ID}-odo`,
      });
    });

    await vi.waitFor(() => {
      expect(push).toHaveBeenCalledWith(intakeContractHref("wo-1"));
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("uses already-saved receipts when the user submits after photos confirm", async () => {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    await act(async () => {
      root.render(
        createElement(
          PhotoUploadQueueProvider,
          {
            userId: SCOPE.userId,
            locationId: SCOPE.locationId,
            store,
            uploadIntakePhoto: async (_id, _prev, form) => ({
              error: null,
              photoId: PHOTO_ID,
              clientUploadId: String(form.get("client_upload_id")),
            }),
          },
          createElement(IntakePhotoRecoveryForm, {
            workOrderId: "wo-1",
            missingCategories: ["vin", "odometer"],
          })
        )
      );
    });

    for (const [label, name] of [
      ["VIN photo library", "vin.jpg"],
      ["Dash / odometer (bike on, mileage showing) photo library", "odo.jpg"],
    ] as const) {
      const input = container.querySelector(
        `input[aria-label="${label}"]`
      ) as HTMLInputElement;
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [photoFile(name)],
      });
      await act(async () => {
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }

    await vi.waitFor(async () => {
      expect(await store.list(SCOPE)).toHaveLength(0);
      expect(await store.listConfirmations(SCOPE)).toHaveLength(2);
    });

    const submit = Array.from(container.querySelectorAll("button")).find((button) =>
      /continue|upload remaining photos/i.test(button.textContent ?? "")
    ) as HTMLButtonElement;
    await act(async () => {
      submit.click();
    });

    await vi.waitFor(() => {
      expect(push).toHaveBeenCalledWith(intakeContractHref("wo-1"));
    });
  });

  it("retries a failed queued item to Saved and submits without retaking", async () => {
    const database = createMemoryPhotoUploadQueueDatabase();
    const store = new MemoryPhotoUploadQueueStore(database);
    await store.put(SCOPE, {
      queueId: "failed-vin",
      clientUploadId: "client-vin",
      userId: SCOPE.userId,
      locationId: SCOPE.locationId,
      workOrderId: "wo-1",
      category: "vin",
      blob: new Blob(["vin-bytes"], { type: "image/jpeg" }),
      fileName: "vin.jpg",
      mimeType: "image/jpeg",
      lastModified: 1,
      byteCount: 9,
      status: "failed",
      attemptCount: 1,
      retryAt: null,
      lastError: "network",
      createdAt: 1,
      updatedAt: 1,
      leaseOwner: null,
      leaseExpiresAt: null,
      uploadSlotOwner: null,
      uploadSlotExpiresAt: null,
    });
    database.confirmations.set("receipt-odo", {
      queueId: "receipt-odo",
      clientUploadId: "client-odo",
      photoId: `${PHOTO_ID}-odo`,
      userId: SCOPE.userId,
      locationId: SCOPE.locationId,
      confirmedAt: Date.now(),
      category: "odometer",
      workOrderId: "wo-1",
    });

    const uploadIntakePhoto = vi.fn(
      async (_id: string, _prev: unknown, form: FormData) => ({
        error: null,
        photoId: `${PHOTO_ID}-vin`,
        clientUploadId: String(form.get("client_upload_id")),
      })
    );

    await act(async () => {
      root.render(
        createElement(
          PhotoUploadQueueProvider,
          {
            userId: SCOPE.userId,
            locationId: SCOPE.locationId,
            store,
            uploadIntakePhoto,
          },
          createElement(IntakePhotoRecoveryForm, {
            workOrderId: "wo-1",
            workOrderNumber: "WO-1",
            missingCategories: ["vin", "odometer"],
          })
        )
      );
    });

    await vi.waitFor(() => {
      expect(container.textContent).toMatch(/1\/2/);
      expect(container.textContent).toMatch(/Retry/i);
    });
    expect(container.textContent).not.toMatch(/Ready to continue/i);
    const continueBeforeRetry = Array.from(container.querySelectorAll("button")).find(
      (button) => /^continue$/i.test(button.textContent ?? "")
    );
    expect(continueBeforeRetry).toBeUndefined();
    expect(container.querySelector('input[aria-label="VIN photo library"]')).toBeTruthy();
    const hiddenVin = container.querySelector(
      'input[name="intake_vin_present"]'
    ) as HTMLInputElement | null;
    const hiddenOdo = container.querySelector(
      'input[name="intake_odometer_present"]'
    ) as HTMLInputElement | null;
    expect(hiddenVin?.required ?? false).toBe(false);
    expect(hiddenOdo?.required ?? false).toBe(false);

    const retry = container.querySelector(
      'button[aria-label="Retry VIN photo"]'
    ) as HTMLButtonElement;
    expect(retry).toBeTruthy();
    await act(async () => {
      retry.click();
    });

    await vi.waitFor(async () => {
      const receipts = await store.listConfirmations(SCOPE);
      expect(receipts.some((receipt) => receipt.queueId === "failed-vin")).toBe(true);
    });
    expect(uploadIntakePhoto).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(container.textContent).toMatch(/2\/2/);
      expect(container.textContent).toMatch(/Ready to continue/i);
    });

    const submit = Array.from(container.querySelectorAll("button")).find((button) =>
      /continue|upload remaining photos/i.test(button.textContent ?? "")
    ) as HTMLButtonElement;
    await act(async () => {
      submit.click();
    });

    await vi.waitFor(() => {
      expect(push).toHaveBeenCalledWith(intakeContractHref("wo-1"));
    });
    expect(uploadIntakePhoto).toHaveBeenCalledTimes(1);
    expect(container.querySelector('input[aria-label="VIN photo library"]')).toBeTruthy();
  });

  it("lists remaining categories when wait fails on missing queue ids", async () => {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    await store.put(SCOPE, {
      queueId: "queued-vin",
      clientUploadId: "client-vin",
      userId: SCOPE.userId,
      locationId: SCOPE.locationId,
      workOrderId: "wo-1",
      category: "vin",
      blob: new Blob(["vin-bytes"], { type: "image/jpeg" }),
      fileName: "vin.jpg",
      mimeType: "image/jpeg",
      lastModified: 1,
      byteCount: 9,
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
    await store.put(SCOPE, {
      queueId: "queued-odo",
      clientUploadId: "client-odo",
      userId: SCOPE.userId,
      locationId: SCOPE.locationId,
      workOrderId: "wo-1",
      category: "odometer",
      blob: new Blob(["odo-bytes"], { type: "image/jpeg" }),
      fileName: "odo.jpg",
      mimeType: "image/jpeg",
      lastModified: 1,
      byteCount: 9,
      status: "queued",
      attemptCount: 0,
      retryAt: null,
      lastError: null,
      createdAt: 2,
      updatedAt: 2,
      leaseOwner: null,
      leaseExpiresAt: null,
      uploadSlotOwner: null,
      uploadSlotExpiresAt: null,
    });

    let api!: PhotoUploadQueueApi;
    await act(async () => {
      root.render(
        createElement(
          PhotoUploadQueueProvider,
          {
            userId: SCOPE.userId,
            locationId: SCOPE.locationId,
            store,
            isOnline: () => false,
            uploadIntakePhoto: async () => ({ error: "offline" }),
          },
          createElement(
            "div",
            null,
            createElement(QueueProbe, {
              onReady: (next) => {
                api = next;
              },
            }),
            createElement(IntakePhotoRecoveryForm, {
              workOrderId: "wo-1",
              missingCategories: ["vin", "odometer"],
            })
          )
        )
      );
    });

    await vi.waitFor(() => {
      expect(container.textContent).toMatch(/2\/2/);
    });

    const submit = Array.from(container.querySelectorAll("button")).find((button) =>
      /continue|upload remaining photos/i.test(button.textContent ?? "")
    ) as HTMLButtonElement;
    await act(async () => {
      submit.click();
    });
    expect(push).not.toHaveBeenCalled();

    await act(async () => {
      await store.remove("queued-vin", SCOPE);
      await store.remove("queued-odo", SCOPE);
      await api.remove("queued-vin");
    });

    await vi.waitFor(() => {
      expect(container.textContent).toMatch(/Missing:.*VIN/i);
      expect(container.textContent).toMatch(/Odometer/i);
      expect(container.textContent).not.toMatch(/Missing: \./);
    });
  });
});
