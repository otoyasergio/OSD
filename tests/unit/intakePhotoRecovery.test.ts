/** @vitest-environment jsdom */
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntakePhotoRecoveryForm } from "@/components/forms/IntakePhotoRecoveryForm";
import { PhotoUploadQueueProvider } from "@/components/photos/PhotoUploadQueueProvider";
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

describe("requiredQueueIdsForRemainingCategories", () => {
  it("prefers enqueue ids, then scoped items, then durable receipts", () => {
    const built = requiredQueueIdsForRemainingCategories({
      remaining: ["vin", "odometer", "front"],
      workOrderId: "wo-1",
      preferredByCategory: { vin: "enqueued-vin" },
      items: [
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
      /upload remaining photos/i.test(button.textContent ?? "")
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
      /upload remaining photos/i.test(button.textContent ?? "")
    ) as HTMLButtonElement;
    await act(async () => {
      submit.click();
    });

    await vi.waitFor(() => {
      expect(push).toHaveBeenCalledWith(intakeContractHref("wo-1"));
    });
  });
});
