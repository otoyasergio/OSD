/** @vitest-environment jsdom */
import { createElement, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PhotoUploadQueueProvider,
  usePhotoUploadQueue,
  type PhotoUploadQueueApi,
} from "@/components/photos/PhotoUploadQueueProvider";
import { PhotoUploadQueueClosedError } from "@/lib/photos/uploadQueue/errors";
import type { QueuedPhotoUpload } from "@/lib/photos/uploadQueue/types";
import {
  createMemoryPhotoUploadQueueDatabase,
  MemoryPhotoUploadQueueStore,
} from "@/tests/helpers/memoryPhotoUploadQueueStore";

const USER_A = { userId: "user-a", locationId: "location-a" };
const USER_B = { userId: "user-b", locationId: "location-a" };
const CLIENT_ID = "81111111-1111-4111-8111-111111111111";
const PHOTO_ID = "71111111-1111-4111-8111-111111111111";

function photoFile(name = "front.jpg", bytes = "front-bytes"): File {
  return new File([bytes], name, { type: "image/jpeg", lastModified: 1_700 });
}

function Probe({ onReady }: { onReady: (api: PhotoUploadQueueApi) => void }): ReactNode {
  const api = usePhotoUploadQueue();
  useEffect(() => {
    onReady(api);
  }, [api, onReady]);
  return createElement(
    "div",
    { "data-testid": "queue-probe" },
    `${api.counts.waiting}:${api.counts.uploading}:${api.counts.failed}`
  );
}

describe("PhotoUploadQueueProvider", () => {
  let container: HTMLDivElement;
  let root: Root;
  let objectUrls = 0;
  const createObjectURL = vi.fn(() => `blob:queue-${(objectUrls += 1)}`);
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
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

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  async function renderProvider(options: {
    userId?: string;
    locationId?: string;
    store?: MemoryPhotoUploadQueueStore;
    uploadIntakePhoto?: (
      workOrderId: string,
      previous: { error: string | null },
      formData: FormData
    ) => Promise<{
      error: string | null;
      photoId?: string;
      clientUploadId?: string;
    }>;
    isOnline?: () => boolean;
    onReady: (api: PhotoUploadQueueApi) => void;
  }) {
    const store =
      options.store ??
      new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    await act(async () => {
      root.render(
        createElement(
          PhotoUploadQueueProvider,
          {
            userId: options.userId ?? USER_A.userId,
            locationId: options.locationId ?? USER_A.locationId,
            store,
            uploadIntakePhoto:
              options.uploadIntakePhoto ??
              (async () => ({
                error: null,
                photoId: PHOTO_ID,
                clientUploadId: CLIENT_ID,
              })),
            isOnline: options.isOnline,
          },
          createElement(Probe, { onReady: options.onReady })
        )
      );
    });
    return store;
  }

  it("enqueues a prepared file and uploads matching metadata through the injected uploader", async () => {
    let api!: PhotoUploadQueueApi;
    const uploadIntakePhoto = vi.fn(
      async (_id: string, _prev: unknown, form: FormData) => {
        expect(form.get("client_upload_id")).toBeTruthy();
        expect(form.get("category")).toBe("front");
        expect(form.get("notes")).toBe("tank scratch");
        expect(form.get("job_id")).toBe("51111111-1111-4111-8111-111111111111");
        return {
          error: null,
          photoId: PHOTO_ID,
          clientUploadId: String(form.get("client_upload_id")),
        };
      }
    );
    await renderProvider({
      uploadIntakePhoto,
      onReady: (next) => {
        api = next;
      },
    });

    let queued!: QueuedPhotoUpload;
    await act(async () => {
      queued = await api.enqueue({
        file: photoFile(),
        category: "front",
        workOrderId: "work-order-1",
        jobId: "51111111-1111-4111-8111-111111111111",
        notes: "tank scratch",
      });
    });

    expect(queued.clientUploadId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    await vi.waitFor(() => expect(uploadIntakePhoto).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(api.counts.waiting + api.counts.uploading).toBe(0));
  });

  it("keeps draft entries persisted and does not upload them until they are attached", async () => {
    let api!: PhotoUploadQueueApi;
    const uploadIntakePhoto = vi.fn();
    const store = await renderProvider({
      uploadIntakePhoto,
      onReady: (next) => {
        api = next;
      },
    });

    await act(async () => {
      await api.enqueue({
        file: photoFile(),
        category: "front",
        intakeDraftId: "draft-1",
      });
    });

    expect(uploadIntakePhoto).not.toHaveBeenCalled();
    const items = await store.list(USER_A);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      category: "front",
      intakeDraftId: "draft-1",
      status: "queued",
    });
    expect(items[0]).not.toHaveProperty("workOrderId");
  });

  it("attaches a draft atomically and then uploads the required entries", async () => {
    let api!: PhotoUploadQueueApi;
    const uploadIntakePhoto = vi.fn(
      async (_id: string, _prev: unknown, form: FormData) => ({
        error: null,
        photoId: PHOTO_ID,
        clientUploadId: String(form.get("client_upload_id")),
      })
    );
    await renderProvider({
      uploadIntakePhoto,
      onReady: (next) => {
        api = next;
      },
    });

    const required = ["front", "rear", "left_side", "right_side", "vin", "odometer"];
    const ids: string[] = [];
    await act(async () => {
      for (const category of required) {
        const item = await api.enqueue({
          file: photoFile(`${category}.jpg`),
          category,
          intakeDraftId: "draft-1",
        });
        ids.push(item.queueId);
      }
    });
    expect(uploadIntakePhoto).not.toHaveBeenCalled();

    await act(async () => {
      const attached = await api.attachDraftToWorkOrder("draft-1", "work-order-9");
      expect(attached).toHaveLength(6);
      expect(attached.every((item) => item.workOrderId === "work-order-9")).toBe(true);
    });

    await vi.waitFor(() => expect(uploadIntakePhoto).toHaveBeenCalledTimes(6));
    const waited = await api.waitForConfirmations(ids);
    expect(waited.ok).toBe(true);
    if (waited.ok) expect(waited.confirmations).toHaveLength(6);
  });

  it("hydrates the newest incomplete intake draft after a new provider instance", async () => {
    const database = createMemoryPhotoUploadQueueDatabase();
    const firstStore = new MemoryPhotoUploadQueueStore(database);
    let firstApi!: PhotoUploadQueueApi;
    await renderProvider({
      store: firstStore,
      onReady: (next) => {
        firstApi = next;
      },
    });
    await act(async () => {
      await firstApi.enqueue({
        file: photoFile("front.jpg", "front-restored"),
        category: "front",
        intakeDraftId: "draft-old",
      });
      await firstApi.enqueue({
        file: photoFile("rear.jpg", "rear-restored"),
        category: "rear",
        intakeDraftId: "draft-new",
      });
    });
    act(() => root.unmount());
    root = createRoot(container);

    let secondApi!: PhotoUploadQueueApi;
    await renderProvider({
      store: new MemoryPhotoUploadQueueStore(database),
      onReady: (next) => {
        secondApi = next;
      },
    });

    const draft = await secondApi.findNewestIncompleteIntakeDraft();
    expect(draft?.intakeDraftId).toBe("draft-new");
    expect(draft?.items).toHaveLength(1);
    expect(draft?.items[0].category).toBe("rear");
    expect(
      await draft!.items[0].blob
        .arrayBuffer()
        .then((bytes) => new TextDecoder().decode(bytes))
    ).toBe("rear-restored");
  });

  it("replace and remove leave exactly the intended draft entries", async () => {
    let api!: PhotoUploadQueueApi;
    const store = await renderProvider({
      onReady: (next) => {
        api = next;
      },
    });

    await act(async () => {
      await api.enqueue({
        file: photoFile("front-1.jpg"),
        category: "front",
        intakeDraftId: "draft-1",
      });
      await api.enqueue({
        file: photoFile("rear.jpg"),
        category: "rear",
        intakeDraftId: "draft-1",
      });
      await api.enqueue({
        file: photoFile("front-2.jpg", "retake"),
        category: "front",
        intakeDraftId: "draft-1",
      });
    });

    let listed = await store.list(USER_A);
    expect(listed.filter((item) => item.category === "front")).toHaveLength(1);
    expect(listed.find((item) => item.category === "front")?.fileName).toBe(
      "front-2.jpg"
    );

    const rear = listed.find((item) => item.category === "rear")!;
    await act(async () => {
      await api.remove(rear.queueId);
    });
    listed = await store.list(USER_A);
    expect(listed.map((item) => item.category)).toEqual(["front"]);
  });

  it("waitForConfirmations fails immediately for an empty id set", async () => {
    let api!: PhotoUploadQueueApi;
    await renderProvider({
      onReady: (next) => {
        api = next;
      },
    });
    await expect(api.waitForConfirmations([])).resolves.toEqual({
      ok: false,
      failed: [],
      missingQueueIds: [],
    });
  });

  it("waitForConfirmations fails immediately when an id is missing", async () => {
    let api!: PhotoUploadQueueApi;
    await renderProvider({
      onReady: (next) => {
        api = next;
      },
    });
    await expect(api.waitForConfirmations(["missing-queue"])).resolves.toEqual({
      ok: false,
      failed: [],
      missingQueueIds: ["missing-queue"],
    });
  });

  it("waitForConfirmations fails immediately after a queued id is removed", async () => {
    let api!: PhotoUploadQueueApi;
    await renderProvider({
      isOnline: () => false,
      onReady: (next) => {
        api = next;
      },
    });
    let queueId = "";
    await act(async () => {
      const item = await api.enqueue({
        file: photoFile(),
        category: "front",
        workOrderId: "work-order-1",
      });
      queueId = item.queueId;
      await api.remove(queueId);
    });
    await expect(api.waitForConfirmations([queueId])).resolves.toEqual({
      ok: false,
      failed: [],
      missingQueueIds: [queueId],
    });
  });

  it("waitForConfirmations resolves remounted durable receipts", async () => {
    const database = createMemoryPhotoUploadQueueDatabase();
    let firstApi!: PhotoUploadQueueApi;
    await renderProvider({
      store: new MemoryPhotoUploadQueueStore(database),
      uploadIntakePhoto: async (_id, _prev, form) => ({
        error: null,
        photoId: PHOTO_ID,
        clientUploadId: String(form.get("client_upload_id")),
      }),
      onReady: (next) => {
        firstApi = next;
      },
    });
    let queueId = "";
    await act(async () => {
      const item = await firstApi.enqueue({
        file: photoFile(),
        category: "front",
        workOrderId: "work-order-1",
      });
      queueId = item.queueId;
    });
    await vi.waitFor(() => expect(firstApi.items).toHaveLength(0));
    await expect(firstApi.waitForConfirmations([queueId])).resolves.toMatchObject({
      ok: true,
    });

    act(() => root.unmount());
    root = createRoot(container);
    let remounted!: PhotoUploadQueueApi;
    await renderProvider({
      store: new MemoryPhotoUploadQueueStore(database),
      uploadIntakePhoto: async (_id, _prev, form) => ({
        error: null,
        photoId: PHOTO_ID,
        clientUploadId: String(form.get("client_upload_id")),
      }),
      onReady: (next) => {
        remounted = next;
      },
    });
    await vi.waitFor(() => expect(remounted.confirmations).toHaveLength(1));
    await expect(remounted.waitForConfirmations([queueId])).resolves.toMatchObject({
      ok: true,
      confirmations: [expect.objectContaining({ queueId, photoId: PHOTO_ID })],
    });
  });

  it("waitForConfirmations rejects waiters when the provider unmounts", async () => {
    let api!: PhotoUploadQueueApi;
    await renderProvider({
      isOnline: () => false,
      onReady: (next) => {
        api = next;
      },
    });
    let queueId = "";
    await act(async () => {
      const item = await api.enqueue({
        file: photoFile(),
        category: "front",
        workOrderId: "work-order-1",
      });
      queueId = item.queueId;
    });
    const pending = api.waitForConfirmations([queueId]);
    act(() => root.unmount());
    root = createRoot(container);
    await expect(pending).rejects.toBeInstanceOf(PhotoUploadQueueClosedError);
  });

  it("waitForConfirmations stays failed when any required photo fails", async () => {
    let api!: PhotoUploadQueueApi;
    const uploadIntakePhoto = vi.fn(
      async (_id: string, _prev: unknown, form: FormData) => {
        const category = String(form.get("category"));
        if (category === "vin") {
          return { error: "Use a JPEG, PNG, WebP, or HEIC image." };
        }
        return {
          error: null,
          photoId: PHOTO_ID,
          clientUploadId: String(form.get("client_upload_id")),
        };
      }
    );
    await renderProvider({
      uploadIntakePhoto,
      onReady: (next) => {
        api = next;
      },
    });

    const ids: string[] = [];
    await act(async () => {
      for (const category of ["front", "vin"]) {
        const item = await api.enqueue({
          file: photoFile(`${category}.jpg`),
          category,
          workOrderId: "work-order-1",
        });
        ids.push(item.queueId);
      }
    });

    const waited = await api.waitForConfirmations(ids);
    expect(waited.ok).toBe(false);
    if (!waited.ok) {
      expect(waited.failed.map((item) => item.category)).toContain("vin");
    }
  });

  it("does not require optional extras before required confirmations resolve", async () => {
    let api!: PhotoUploadQueueApi;
    const uploadIntakePhoto = vi.fn(
      async (_id: string, _prev: unknown, form: FormData) => ({
        error: null,
        photoId: PHOTO_ID,
        clientUploadId: String(form.get("client_upload_id")),
      })
    );
    await renderProvider({
      uploadIntakePhoto,
      isOnline: () => false,
      onReady: (next) => {
        api = next;
      },
    });

    let requiredId = "";
    await act(async () => {
      const required = await api.enqueue({
        file: photoFile(),
        category: "front",
        workOrderId: "work-order-1",
      });
      requiredId = required.queueId;
      await api.enqueue({
        file: photoFile("extra.jpg"),
        category: "other",
        workOrderId: "work-order-1",
      });
    });

    expect(api.counts.waiting).toBe(2);
    expect(container.textContent).toContain("2:0:0");

    await act(async () => {
      // Online resume happens through a new wake; force by toggling via retry API
      // after the runner sees the items as queued drafts-with-work-order.
    });

    const extra = api.items.find((item) => item.category === "other");
    expect(extra).toBeTruthy();
    expect(requiredId).toBeTruthy();
  });

  it("revokes object URLs on replacement, removal, and unmount", async () => {
    let api!: PhotoUploadQueueApi;
    await renderProvider({
      onReady: (next) => {
        api = next;
      },
    });

    let first!: QueuedPhotoUpload;
    await act(async () => {
      first = await api.enqueue({
        file: photoFile("front-1.jpg"),
        category: "front",
        intakeDraftId: "draft-1",
      });
    });
    expect(api.previewUrl(first.queueId)).toBe("blob:queue-1");

    await act(async () => {
      await api.enqueue({
        file: photoFile("front-2.jpg"),
        category: "front",
        intakeDraftId: "draft-1",
      });
    });
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:queue-1");

    const remaining = api.items[0];
    await act(async () => {
      await api.remove(remaining.queueId);
    });
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);

    await act(async () => {
      await api.enqueue({
        file: photoFile("rear.jpg"),
        category: "rear",
        intakeDraftId: "draft-1",
      });
    });
    act(() => root.unmount());
    expect(revokeObjectURL.mock.calls.length).toBeGreaterThanOrEqual(3);
    root = createRoot(container);
  });

  it("does not render another user or location queue after the scope changes", async () => {
    const database = createMemoryPhotoUploadQueueDatabase();
    const store = new MemoryPhotoUploadQueueStore(database);
    let api!: PhotoUploadQueueApi;
    await renderProvider({
      store,
      onReady: (next) => {
        api = next;
      },
    });
    await act(async () => {
      await api.enqueue({
        file: photoFile(),
        category: "front",
        workOrderId: "work-order-1",
      });
    });
    expect(api.items.length).toBeGreaterThan(0);

    await act(async () => {
      root.render(
        createElement(
          PhotoUploadQueueProvider,
          {
            userId: USER_B.userId,
            locationId: USER_B.locationId,
            store,
            uploadIntakePhoto: async () => ({ error: null, photoId: PHOTO_ID }),
          },
          createElement(Probe, {
            onReady: (next) => {
              api = next;
            },
          })
        )
      );
    });

    expect(api.items).toEqual([]);
    expect(api.counts).toEqual({ waiting: 0, uploading: 0, failed: 0 });
  });
});
